using System;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Islee.UnityRemote.Editor
{
    public static class ConnectorDispatch
    {
        /// <summary>
        /// Entry point for callers that cannot reference Newtonsoft (the EditMode test assembly).
        /// </summary>
        public static object Invoke(string method, string payloadJson)
        {
            var payload = string.IsNullOrEmpty(payloadJson) ? new JObject() : JToken.Parse(payloadJson);
            return Invoke(method, payload);
        }

        internal static object Invoke(string method, JToken payload)
        {
            switch (method)
            {
                case "getProjectSnapshot":
                    return UnityRemoteBridge.CaptureProject();
                case "inspectObject":
                    return UnityRemoteBridge.InspectObject(
                        (string)payload["objectId"],
                        (string)payload["projectId"]);
                case "previewEdit":
                    return UnityRemoteBridge.PreviewEdit(payload.ToObject<EditRequest>(JsonSerializer.Create(ProtocolJson.Settings)));
                case "applyEdit":
                    return UnityRemoteBridge.ApplyEdit(payload.ToObject<EditRequest>(JsonSerializer.Create(ProtocolJson.Settings)));
                case "saveScene":
                    return UnityRemoteBridge.SaveScene(payload.ToObject<SaveRequest>(JsonSerializer.Create(ProtocolJson.Settings)));
                case "createContext":
                    var ids = payload["objectIds"]?.ToObject<string[]>() ?? Array.Empty<string>();
                    return UnityRemoteBridge.CreateContext(ids, (string)payload["projectId"]);
                case "getPlayState":
                    return UnityRemotePlayMode.GetState();
                case "setPlayMode":
                    return UnityRemotePlayMode.SetPlaying(ParsePlayModeRequest(payload).playing);
                case "setActive":
                    return UnityRemoteBridge.SetActive(payload.ToObject<SetActiveRequest>(JsonSerializer.Create(ProtocolJson.Settings)));
                case "getGameViewFrame":
                    return UnityRemoteGameView.GetFrame();
                case "sendGameInput":
                    return UnityRemoteInput.Send(payload.ToObject<GameInput>(JsonSerializer.Create(ProtocolJson.Settings)));
                default:
                    throw new UnityRemoteException("INVALID_REQUEST", $"Unknown method '{method}'.", 400);
            }
        }

        private static PlayModeRequest ParsePlayModeRequest(JToken payload)
        {
            if (payload == null || payload["playing"] == null || payload["playing"].Type == JTokenType.Null)
            {
                throw new UnityRemoteException("INVALID_REQUEST", "setPlayMode requires a boolean 'playing'.", 400);
            }

            if (payload["playing"].Type != JTokenType.Boolean)
            {
                throw new UnityRemoteException("INVALID_REQUEST", "setPlayMode 'playing' must be a boolean.", 400);
            }

            return payload.ToObject<PlayModeRequest>(JsonSerializer.Create(ProtocolJson.Settings));
        }
    }
}
