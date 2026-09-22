using System;
using System.Collections.Concurrent;
using System.IO;
using System.Net.WebSockets;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using UnityEditor;
using UnityEngine;

namespace Islee.UnityRemote.Editor
{
    [InitializeOnLoad]
    public static class UnityRemoteConnector
    {
        private static readonly ConcurrentQueue<Action> MainThread = new ConcurrentQueue<Action>();
        private static CancellationTokenSource cancellation;
        private static ClientWebSocket socket;
        private static readonly EventCoalescer pendingEvents = new EventCoalescer();
        private static double nextEventTime;

        public const string BrokerUrlPreferenceKey = "Islee.UnityRemote.BrokerUrl";
        public const string TokenPreferenceKey = "Islee.UnityRemote.Token";
        public const string DefaultBrokerUrl = "http://127.0.0.1:4173";

        static UnityRemoteConnector()
        {
            EditorApplication.update += Pump;
            EditorApplication.hierarchyChanged += () =>
            {
                if (UnityRemoteBridge.IsSuppressingExternalEvents)
                {
                    return;
                }

                QueueEvent(new ProtocolEvent
                {
                    type = "hierarchyChanged",
                    projectId = UnityRemoteBridge.ProjectId
                });
            };
            EditorApplication.playModeStateChanged += _ => QueueEvent(new ProtocolEvent
            {
                type = "playModeChanged",
                projectId = UnityRemoteBridge.ProjectId
            });
            UnityRemoteBridge.ObjectRevisionChanged += QueueEvent;
            EditorApplication.quitting += Stop;
            StartConnectLoop();
        }

        private static void StartConnectLoop()
        {
            var token = ResolveToken();
            if (!ShouldConnect(Environment.CommandLine, Application.isBatchMode, token))
            {
                return;
            }

            cancellation = new CancellationTokenSource();
            _ = ConnectLoop(cancellation.Token);
        }

        private static async Task ConnectLoop(CancellationToken token)
        {
            while (!token.IsCancellationRequested)
            {
                try
                {
                    await ConnectOnce(token);
                }
                catch
                {
                    // The editor may be compiling or the broker may be restarting.
                }

                try
                {
                    await Task.Delay(2000, token);
                }
                catch (TaskCanceledException)
                {
                    return;
                }
            }
        }

        private static async Task ConnectOnce(CancellationToken token)
        {
            var sessionToken = ResolveToken();
            if (string.IsNullOrEmpty(sessionToken))
            {
                return;
            }

            socket?.Dispose();
            var current = new ClientWebSocket();
            socket = current;
            await current.ConnectAsync(ConnectorUri(), token);
            var hello = ProtocolJson.ToJson(new ConnectorHello { token = sessionToken });
            await WebSocketText.SendAsync(current, hello, token);

            while (current.State == WebSocketState.Open && !token.IsCancellationRequested)
            {
                var message = await WebSocketText.ReceiveAsync(current, token);
                if (string.IsNullOrEmpty(message))
                {
                    continue;
                }

                var parsed = JObject.Parse(message);
                if ((string)parsed["type"] == "hello-ok")
                {
                    continue;
                }

                if ((string)parsed["type"] != "request")
                {
                    continue;
                }

                var id = (string)parsed["id"];
                var method = (string)parsed["method"];
                var payload = parsed["payload"];
                try
                {
                    var result = await RunOnMainThread(() => ConnectorDispatch.Invoke(method, payload));
                    await WebSocketText.SendAsync(current, ProtocolJson.ToJson(new ConnectorResponse
                    {
                        id = id,
                        ok = true,
                        payload = result
                    }), token);
                }
                catch (UnityRemoteException error)
                {
                    await WebSocketText.SendAsync(current, ProtocolJson.ToJson(new ConnectorResponse
                    {
                        id = id,
                        ok = false,
                        error = error.ToErrorBody()
                    }), token);
                }
                catch (Exception)
                {
                    await WebSocketText.SendAsync(current, ProtocolJson.ToJson(new ConnectorResponse
                    {
                        id = id,
                        ok = false,
                        error = ErrorBody.Internal()
                    }), token);
                }
            }
        }

        private static void QueueEvent(ProtocolEvent payload)
        {
            pendingEvents.Queue(payload);
            nextEventTime = EditorApplication.timeSinceStartup + 0.15;
        }

        private static void Pump()
        {
            while (MainThread.TryDequeue(out var action))
            {
                action();
            }

            if (pendingEvents.HasPending && EditorApplication.timeSinceStartup >= nextEventTime)
            {
                foreach (var payload in pendingEvents.Flush())
                {
                    _ = SendEvent(payload);
                }
            }
        }

        private static async Task SendEvent(ProtocolEvent payload)
        {
            var current = socket;
            if (current == null || current.State != WebSocketState.Open)
            {
                return;
            }

            try
            {
                await WebSocketText.SendAsync(current, ProtocolJson.ToJson(new ConnectorEvent { @event = payload }), CancellationToken.None);
            }
            catch (Exception)
            {
                // The receive loop reconnects.
            }
        }

        private static Task<T> RunOnMainThread<T>(Func<T> action)
        {
            var completion = new TaskCompletionSource<T>();
            MainThread.Enqueue(() =>
            {
                try
                {
                    completion.SetResult(action());
                }
                catch (Exception error)
                {
                    completion.SetException(error);
                }
            });
            return completion.Task;
        }

        public static Uri ConnectorUri()
        {
            var uri = new Uri(ResolveBrokerUrl());
            var scheme = uri.Scheme == "https" || uri.Scheme == "wss" ? "wss" : "ws";
            return new Uri($"{scheme}://{uri.Authority}/connector");
        }

        public static string ResolveBrokerUrl()
        {
            var env = Environment.GetEnvironmentVariable("UNITY_REMOTE_BROKER")?.Trim();
            if (!string.IsNullOrEmpty(env))
            {
                return env;
            }

            var stored = EditorPrefs.GetString(BrokerUrlPreferenceKey, string.Empty).Trim();
            return string.IsNullOrEmpty(stored) ? DefaultBrokerUrl : stored;
        }

        public static string ResolveToken()
        {
            var env = Environment.GetEnvironmentVariable("UNITY_REMOTE_TOKEN")?.Trim();
            if (!string.IsNullOrEmpty(env))
            {
                return env;
            }

            var stored = EditorPrefs.GetString(TokenPreferenceKey, string.Empty).Trim();
            return string.IsNullOrEmpty(stored) ? ReadTokenFile() : stored;
        }

        public static bool ShouldConnect(string commandLine, bool isBatchMode, string token)
        {
            if (commandLine.IndexOf("AssetImportWorker", StringComparison.OrdinalIgnoreCase) >= 0)
            {
                return false;
            }

            return !isBatchMode || !string.IsNullOrEmpty(token);
        }

        private static string ReadTokenFile()
        {
            try
            {
                var root = Directory.GetParent(Application.dataPath)?.FullName;
                if (root == null)
                {
                    return string.Empty;
                }

                var path = Path.Combine(root, ".unity-remote-token");
                return File.Exists(path) ? File.ReadAllText(path).Trim() : string.Empty;
            }
            catch
            {
                return string.Empty;
            }
        }

        private static void Stop()
        {
            cancellation?.Cancel();
            try
            {
                socket?.Abort();
            }
            catch
            {
                // ignored
            }
        }
    }
}
