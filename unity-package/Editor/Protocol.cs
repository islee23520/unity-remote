using System.Collections.Generic;

namespace Islee.UnityRemote.Editor
{
    public static class Protocol
    {
        public const int Version = 1;
    }

    public sealed class AssetRoot
    {
        public string name { get; set; } = string.Empty;
        public string path { get; set; } = string.Empty;
    }

    public sealed class ProjectSummary
    {
        public string id { get; set; } = string.Empty;
        public string name { get; set; } = string.Empty;
        public string unityVersion { get; set; } = string.Empty;
        public bool connected { get; set; }
        public string source { get; set; } = "unity";
        public int protocolVersion { get; set; } = Protocol.Version;
        public AssetRoot[] assetRoots { get; set; } = System.Array.Empty<AssetRoot>();
    }

    public sealed class SceneSummary
    {
        public string id { get; set; } = string.Empty;
        public string name { get; set; } = string.Empty;
        public string path { get; set; } = string.Empty;
        public bool loaded { get; set; }
        public bool dirty { get; set; }
        public int revision { get; set; }
    }

    public sealed class HierarchyNode
    {
        public string id { get; set; } = string.Empty;
        public string name { get; set; } = string.Empty;
        public bool active { get; set; }
        public HierarchyNode[] children { get; set; } = System.Array.Empty<HierarchyNode>();
    }

    public sealed class ComponentSnapshot
    {
        public string id { get; set; } = string.Empty;
        public string type { get; set; } = string.Empty;
        public Dictionary<string, object> properties { get; set; } = new Dictionary<string, object>();
        public string[] editableProperties { get; set; } = System.Array.Empty<string>();
        public Dictionary<string, string> propertyDisplayNames { get; set; } = new Dictionary<string, string>();
    }

    public sealed class ObjectSnapshot
    {
        public string id { get; set; } = string.Empty;
        public string sceneId { get; set; } = string.Empty;
        public string name { get; set; } = string.Empty;
        public bool active { get; set; }
        public int revision { get; set; }
        public ComponentSnapshot[] components { get; set; } = System.Array.Empty<ComponentSnapshot>();
    }

    public sealed class ProjectSnapshot
    {
        public ProjectSummary project { get; set; } = new ProjectSummary();
        public SceneSummary[] scenes { get; set; } = System.Array.Empty<SceneSummary>();
        public HierarchyNode[] hierarchy { get; set; } = System.Array.Empty<HierarchyNode>();
    }

    public sealed class EditRequest
    {
        public string projectId { get; set; } = string.Empty;
        public string objectId { get; set; } = string.Empty;
        public string componentId { get; set; } = string.Empty;
        public string property { get; set; } = string.Empty;
        public object value { get; set; }
        public int expectedRevision { get; set; }
    }

    public sealed class SaveRequest
    {
        public string projectId { get; set; } = string.Empty;
        public string sceneId { get; set; } = string.Empty;
    }

    public sealed class EditResult
    {
        public string transactionId { get; set; } = string.Empty;
        public string undoGroup { get; set; } = string.Empty;
        public ObjectSnapshot @object { get; set; } = new ObjectSnapshot();
        public object before { get; set; }
        public object after { get; set; }
        public bool sceneDirty { get; set; }
    }

    public sealed class EditPreview
    {
        public bool preview { get; set; } = true;
        public string projectId { get; set; } = string.Empty;
        public string objectId { get; set; } = string.Empty;
        public string componentId { get; set; } = string.Empty;
        public string property { get; set; } = string.Empty;
        public int expectedRevision { get; set; }
        public object before { get; set; }
        public object after { get; set; }
        public string undoGroup { get; set; } = string.Empty;
    }

    public sealed class SaveResult
    {
        public string sceneId { get; set; } = string.Empty;
        public string path { get; set; } = string.Empty;
        public bool dirty { get; set; }
        public int revision { get; set; }
    }

    public sealed class PlayState
    {
        public bool playing { get; set; }
        public bool transitioning { get; set; }
    }

    public sealed class GameViewFrame
    {
        public string mimeType { get; set; } = "image/jpeg";
        public string data { get; set; } = string.Empty;
        public int width { get; set; }
        public int height { get; set; }
    }

    public sealed class GameInput
    {
        public string type { get; set; } = string.Empty;
        public string key { get; set; }
        public int? button { get; set; }
        public double? x { get; set; }
        public double? y { get; set; }
    }

    public sealed class InputResult
    {
        public bool accepted { get; set; }
    }

    public sealed class PlayModeRequest
    {
        public bool playing { get; set; }
    }

    public sealed class SetActiveRequest
    {
        public string projectId { get; set; } = string.Empty;
        public string objectId { get; set; } = string.Empty;
        public bool active { get; set; }
        public int expectedRevision { get; set; }
    }

    public sealed class SetActiveResult
    {
        public string objectId { get; set; } = string.Empty;
        public bool active { get; set; }
        public int revision { get; set; }
        public bool sceneDirty { get; set; }
    }

    public sealed class UnityContext
    {
        public string kind { get; set; } = "unity-project-context";
        public string generatedAt { get; set; } = string.Empty;
        public ProjectSummary project { get; set; } = new ProjectSummary();
        public SceneSummary[] scenes { get; set; } = System.Array.Empty<SceneSummary>();
        public HierarchyNode[] hierarchy { get; set; } = System.Array.Empty<HierarchyNode>();
        public ObjectSnapshot[] objects { get; set; } = System.Array.Empty<ObjectSnapshot>();
    }

    public sealed class InspectRequest
    {
        public string projectId { get; set; }
        public string objectId { get; set; } = string.Empty;
    }

    public sealed class ContextRequest
    {
        public string projectId { get; set; }
        public string[] objectIds { get; set; }
    }

    public sealed class ErrorBody
    {
        public string code { get; set; } = string.Empty;
        public string message { get; set; } = string.Empty;
        public Dictionary<string, object> details { get; set; } = new Dictionary<string, object>();
        public int? statusCode { get; set; }

        public static ErrorBody Internal()
        {
            return new ErrorBody
            {
                code = "INTERNAL_ERROR",
                message = "An unexpected error occurred.",
                details = new Dictionary<string, object>(),
                statusCode = 500
            };
        }
    }

    public sealed class ErrorEnvelope
    {
        public ErrorBody error { get; set; } = new ErrorBody();
    }

    public sealed class ConnectorHello
    {
        public string type { get; set; } = "hello";
        public int protocolVersion { get; set; } = Protocol.Version;
        public string role { get; set; } = "unity";
        public string token { get; set; } = string.Empty;
    }

    public sealed class ConnectorRequest
    {
        public string type { get; set; } = "request";
        public string id { get; set; } = string.Empty;
        public string method { get; set; } = string.Empty;
        public object payload { get; set; }
    }

    public sealed class ConnectorResponse
    {
        public string type { get; set; } = "response";
        public string id { get; set; } = string.Empty;
        public bool ok { get; set; }
        public object payload { get; set; }
        public ErrorBody error { get; set; }
    }

    public sealed class ConnectorEvent
    {
        public string type { get; set; } = "event";
        public ProtocolEvent @event { get; set; } = new ProtocolEvent();
    }

    public sealed class ProtocolEvent
    {
        public string type { get; set; } = string.Empty;
        public string projectId { get; set; } = string.Empty;
        public string sceneId { get; set; }
        public string objectId { get; set; }
        public int? revision { get; set; }
    }
}
