using System;
using System.IO;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace Islee.UnityRemote.Editor
{
    internal static class WebSocketText
    {
        internal static async Task SendAsync(ClientWebSocket socket, string json, CancellationToken token)
        {
            var bytes = Encoding.UTF8.GetBytes(json);
            await socket.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, token);
        }

        internal static async Task<string> ReceiveAsync(ClientWebSocket socket, CancellationToken token)
        {
            var buffer = new byte[8192];
            using (var memory = new MemoryStream())
            {
                WebSocketReceiveResult result;
                do
                {
                    result = await socket.ReceiveAsync(new ArraySegment<byte>(buffer), token);
                    if (result.MessageType == WebSocketMessageType.Close)
                    {
                        return string.Empty;
                    }

                    memory.Write(buffer, 0, result.Count);
                }
                while (!result.EndOfMessage);

                return Encoding.UTF8.GetString(memory.ToArray());
            }
        }
    }
}
