using System.IO;
using NUnit.Framework;
using UnityEngine;

namespace Islee.UnityRemote.Editor.Tests
{
    public sealed class UnityRemoteProtocolTests
    {
        [Test]
        public void RoundTripsSharedContractFixturesAndGenericInternalError()
        {
            var fixtures = FixtureDirectory();
            AssertRoundTrip<ProjectSnapshot>(Path.Combine(fixtures, "project-snapshot.json"));
            AssertRoundTrip<ObjectSnapshot>(Path.Combine(fixtures, "object-snapshot.json"));
            AssertRoundTrip<EditRequest>(Path.Combine(fixtures, "edit-request.json"));
            AssertRoundTrip<EditPreview>(Path.Combine(fixtures, "edit-preview.json"));
            AssertRoundTrip<EditResult>(Path.Combine(fixtures, "edit-result.json"));
            AssertRoundTrip<SaveRequest>(Path.Combine(fixtures, "save-request.json"));
            AssertRoundTrip<SaveResult>(Path.Combine(fixtures, "save-result.json"));
            AssertRoundTrip<SetActiveRequest>(Path.Combine(fixtures, "set-active-request.json"));
            AssertRoundTrip<SetActiveResult>(Path.Combine(fixtures, "set-active-result.json"));
            AssertRoundTrip<PlayState>(Path.Combine(fixtures, "play-state.json"));
            AssertRoundTrip<GameViewFrame>(Path.Combine(fixtures, "game-view-frame.json"));
            AssertRoundTrip<GameInput>(Path.Combine(fixtures, "game-input.json"));
            AssertRoundTrip<InputResult>(Path.Combine(fixtures, "input-result.json"));
            AssertRoundTrip<PlayModeRequest>(Path.Combine(fixtures, "play-mode-request.json"));
            AssertRoundTrip<InspectRequest>(Path.Combine(fixtures, "inspect-request.json"));
            AssertRoundTrip<ContextRequest>(Path.Combine(fixtures, "context-request.json"));
            AssertRoundTrip<UnityContext>(Path.Combine(fixtures, "unity-context.json"));
            AssertRoundTrip<ProtocolEvent>(Path.Combine(fixtures, "protocol-event.json"));
            AssertRoundTrip<ErrorEnvelope>(Path.Combine(fixtures, "error-envelope.json"));
            AssertRoundTrip<ConnectorHello>(Path.Combine(fixtures, "connector-hello.json"));
            AssertRoundTrip<ConnectorRequest>(Path.Combine(fixtures, "connector-request.json"));
            AssertRoundTrip<ConnectorResponse>(Path.Combine(fixtures, "connector-response-error.json"));
            AssertRoundTrip<ConnectorResponse>(Path.Combine(fixtures, "connector-response-internal-error.json"));
            AssertRoundTrip<ConnectorEvent>(Path.Combine(fixtures, "connector-event.json"));

            var omittedStatus = ProtocolJson.ToJson(new ErrorBody
            {
                code = "INTERNAL_ERROR",
                message = "An unexpected error occurred."
            });
            StringAssert.DoesNotContain("\"statusCode\": 0", omittedStatus);

            var generic = ProtocolJson.ToJson(new ConnectorResponse
            {
                id = "req-internal",
                ok = false,
                error = ErrorBody.Internal()
            });
            AssertCanonical(Path.Combine(fixtures, "connector-response-internal-error.json"), generic);
        }

        [Test]
        public void RoundTripsSetActiveEnvelopesWithWireFieldNamesAndValues()
        {
            var requestJson = ProtocolJson.ToJson(new SetActiveRequest
            {
                projectId = "unity-live",
                objectId = "GlobalObjectId_V1-2-example-0-0",
                active = false,
                expectedRevision = 4
            });
            StringAssert.Contains("\"projectId\": \"unity-live\"", requestJson);
            StringAssert.Contains("\"objectId\": \"GlobalObjectId_V1-2-example-0-0\"", requestJson);
            StringAssert.Contains("\"active\": false", requestJson);
            StringAssert.Contains("\"expectedRevision\": 4", requestJson);
            var request = ProtocolJson.FromJson<SetActiveRequest>(requestJson);
            Assert.That(request.projectId, Is.EqualTo("unity-live"));
            Assert.That(request.objectId, Is.EqualTo("GlobalObjectId_V1-2-example-0-0"));
            Assert.That(request.active, Is.False);
            Assert.That(request.expectedRevision, Is.EqualTo(4));

            var resultJson = ProtocolJson.ToJson(new SetActiveResult
            {
                objectId = "GlobalObjectId_V1-2-example-0-0",
                active = false,
                revision = 5,
                sceneDirty = true
            });
            StringAssert.Contains("\"objectId\": \"GlobalObjectId_V1-2-example-0-0\"", resultJson);
            StringAssert.Contains("\"active\": false", resultJson);
            StringAssert.Contains("\"revision\": 5", resultJson);
            StringAssert.Contains("\"sceneDirty\": true", resultJson);
            var result = ProtocolJson.FromJson<SetActiveResult>(resultJson);
            Assert.That(result.objectId, Is.EqualTo("GlobalObjectId_V1-2-example-0-0"));
            Assert.That(result.active, Is.False);
            Assert.That(result.revision, Is.EqualTo(5));
            Assert.That(result.sceneDirty, Is.True);
        }

        [Test]
        public void CoalescesDistinctEventsInsteadOfDroppingThem()
        {
            var coalescer = new EventCoalescer();
            coalescer.Queue(new ProtocolEvent
            {
                type = "propertyChanged",
                projectId = "unity-live",
                objectId = "object-a",
                revision = 1
            });
            coalescer.Queue(new ProtocolEvent
            {
                type = "propertyChanged",
                projectId = "unity-live",
                objectId = "object-b",
                revision = 2
            });
            coalescer.Queue(new ProtocolEvent
            {
                type = "hierarchyChanged",
                projectId = "unity-live"
            });
            coalescer.Queue(new ProtocolEvent
            {
                type = "propertyChanged",
                projectId = "unity-live",
                objectId = "object-a",
                revision = 3
            });

            var flushed = coalescer.Flush();
            Assert.That(flushed.Length, Is.EqualTo(3));
            Assert.That(flushed[0].objectId, Is.EqualTo("object-a"));
            Assert.That(flushed[0].revision, Is.EqualTo(3));
            Assert.That(flushed[1].objectId, Is.EqualTo("object-b"));
            Assert.That(flushed[2].type, Is.EqualTo("hierarchyChanged"));
            Assert.That(coalescer.HasPending, Is.False);
        }

        private static void AssertRoundTrip<T>(string path)
        {
            var original = File.ReadAllText(path);
            var parsed = ProtocolJson.FromJson<T>(original);
            AssertCanonical(path, ProtocolJson.ToJson(parsed));
        }

        private static void AssertCanonical(string path, string serialized)
        {
            Assert.That(ProtocolJson.JsonEquals(File.ReadAllText(path), serialized), Is.True, path + " serialized as " + serialized);
        }

        private static string FixtureDirectory()
        {
            var root = Directory.GetParent(Application.dataPath);
            Assert.That(root, Is.Not.Null);
            var fixtures = Path.Combine(root.FullName, "contracts", "fixtures");
            Assert.That(Directory.Exists(fixtures), Is.True, fixtures);
            return fixtures;
        }
    }
}
