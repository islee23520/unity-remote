using System.Collections.Generic;

namespace Islee.UnityRemote.Editor
{
    public sealed class EventCoalescer
    {
        private readonly Dictionary<string, ProtocolEvent> pending = new Dictionary<string, ProtocolEvent>();
        private readonly List<string> order = new List<string>();

        public bool HasPending
        {
            get { return pending.Count > 0; }
        }

        public void Queue(ProtocolEvent payload)
        {
            if (payload == null)
            {
                return;
            }

            var key = Key(payload);
            if (!pending.ContainsKey(key))
            {
                order.Add(key);
            }

            pending[key] = payload;
        }

        public ProtocolEvent[] Flush()
        {
            var events = new ProtocolEvent[order.Count];
            for (var index = 0; index < order.Count; index++)
            {
                events[index] = pending[order[index]];
            }

            pending.Clear();
            order.Clear();
            return events;
        }

        private static string Key(ProtocolEvent payload)
        {
            return (payload.type ?? string.Empty)
                + "\n" + (payload.projectId ?? string.Empty)
                + "\n" + (payload.sceneId ?? string.Empty)
                + "\n" + (payload.objectId ?? string.Empty);
        }
    }
}
