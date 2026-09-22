using System.IO;
using System.Linq;
using NUnit.Framework;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace Islee.UnityRemote.Editor.Tests
{
    public sealed class UnityRemoteBridgeTests
    {
        [Test]
        public void CapturesSharedContractAndAppliesAuthoritativeUndoableEdit()
        {
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            var camera = new GameObject("Main Camera");
            camera.AddComponent<Camera>();
            Directory.CreateDirectory("Assets/Scenes");
            var path = "Assets/Scenes/UnityRemoteEditTest.unity";
            EditorSceneManager.SaveScene(scene, path);
            try
            {
                var id = UnityRemoteBridge.GetGlobalObjectId(camera);

                var projectJson = UnityRemoteBridge.CaptureProjectJson();
                StringAssert.Contains("\"protocolVersion\": 1", projectJson);
                StringAssert.Contains("\"source\": \"unity\"", projectJson);
                StringAssert.Contains("Main Camera", projectJson);
                StringAssert.Contains("assetRoots", projectJson);
                StringAssert.DoesNotContain("Serialization depth limit", projectJson);

                var before = UnityRemoteBridge.InspectObject(id);
                var transform = ComponentOfType(before, "UnityEngine.Transform");
                Assert.That(transform.id, Is.Not.Null.And.Not.Empty);
                Assert.That(transform.properties.ContainsKey("m_LocalPosition.x"), Is.True);
                Assert.That(transform.propertyDisplayNames["m_LocalPosition.x"], Is.EqualTo("Position X"));
                Assert.That(before.components, Has.Some.Matches<ComponentSnapshot>(item => item.type == "UnityEngine.Camera"));

                var result = UnityRemoteBridge.ApplyEdit(new EditRequest
                {
                    projectId = UnityRemoteBridge.ProjectId,
                    objectId = id,
                    componentId = transform.id,
                    property = "m_LocalPosition.x",
                    value = 4f,
                    expectedRevision = before.revision
                });

                Assert.That(result.before, Is.EqualTo(0f));
                Assert.That(result.after, Is.EqualTo(4f));
                Assert.That(result.@object.revision, Is.EqualTo(before.revision + 1));
                Assert.That(camera.transform.localPosition.x, Is.EqualTo(4f));
                Assert.That(scene.isDirty, Is.True);
                Assert.That(result.undoGroup, Is.EqualTo("Unity Remote: Main Camera m_LocalPosition.x"));

                Undo.PerformUndo();
                Assert.That(camera.transform.localPosition.x, Is.EqualTo(0f));
            }
            finally
            {
                AssetDatabase.DeleteAsset(path);
            }
        }

        [Test]
        public void RejectsStaleRevisionAfterExternalSerializedEdit()
        {
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            var camera = new GameObject("Main Camera");
            Directory.CreateDirectory("Assets/Scenes");
            var path = "Assets/Scenes/UnityRemoteExternalEditTest.unity";
            EditorSceneManager.SaveScene(scene, path);
            try
            {
                var id = UnityRemoteBridge.GetGlobalObjectId(camera);
                var before = UnityRemoteBridge.InspectObject(id);
                var transform = ComponentOfType(before, "UnityEngine.Transform");

                var serialized = new SerializedObject(camera.transform);
                var property = serialized.FindProperty("m_LocalPosition.x");
                Assert.That(property, Is.Not.Null);
                property.floatValue = 7f;
                serialized.ApplyModifiedProperties();

                var after = UnityRemoteBridge.InspectObject(id);
                Assert.That(after.revision, Is.GreaterThan(before.revision));
                Assert.That(camera.transform.localPosition.x, Is.EqualTo(7f));

                var stale = Assert.Throws<UnityRemoteException>(() => UnityRemoteBridge.ApplyEdit(new EditRequest
                {
                    projectId = UnityRemoteBridge.ProjectId,
                    objectId = id,
                    componentId = transform.id,
                    property = "m_LocalPosition.x",
                    value = 4f,
                    expectedRevision = before.revision
                }));
                Assert.That(stale.code, Is.EqualTo("REVISION_CONFLICT"));
                Assert.That(stale.statusCode, Is.EqualTo(409));
            }
            finally
            {
                AssetDatabase.DeleteAsset(path);
            }
        }

        [Test]
        public void EditsTheSelectedDuplicateComponentByStableId()
        {
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            var body = new GameObject("Body");
            var first = body.AddComponent<BoxCollider>();
            var second = body.AddComponent<BoxCollider>();
            first.size = Vector3.one;
            second.size = new Vector3(2f, 2f, 2f);
            Directory.CreateDirectory("Assets/Scenes");
            var path = "Assets/Scenes/UnityRemoteDuplicateComponentTest.unity";
            EditorSceneManager.SaveScene(scene, path);
            try
            {
                var id = UnityRemoteBridge.GetGlobalObjectId(body);
                var before = UnityRemoteBridge.InspectObject(id);
                var colliders = before.components.Where(item => item.type == "UnityEngine.BoxCollider").ToArray();
                Assert.That(colliders.Length, Is.EqualTo(2));
                Assert.That(colliders[0].id, Is.Not.EqualTo(colliders[1].id));
                Assert.That(colliders[0].properties.ContainsKey("m_Size.x"), Is.True);

                var result = UnityRemoteBridge.ApplyEdit(new EditRequest
                {
                    projectId = UnityRemoteBridge.ProjectId,
                    objectId = id,
                    componentId = colliders[1].id,
                    property = "m_Size.x",
                    value = 9f,
                    expectedRevision = before.revision
                });

                Assert.That(first.size.x, Is.EqualTo(1f));
                Assert.That(second.size.x, Is.EqualTo(9f));
                Assert.That(result.after, Is.EqualTo(9f));
            }
            finally
            {
                AssetDatabase.DeleteAsset(path);
            }
        }

        [Test]
        public void SetActiveDispatchEmitsOneObjectSpecificBridgeEvent()
        {
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            var target = new GameObject("Visibility Target");
            Directory.CreateDirectory("Assets/Scenes");
            var path = "Assets/Scenes/UnityRemoteSetActiveTest.unity";
            EditorSceneManager.SaveScene(scene, path);
            var changed = new System.Collections.Generic.List<ProtocolEvent>();
            System.Action<ProtocolEvent> handler = item =>
            {
                if (item.type == "hierarchyChanged")
                {
                    changed.Add(item);
                }
            };
            UnityRemoteBridge.ObjectRevisionChanged += handler;
            try
            {
                var id = UnityRemoteBridge.GetGlobalObjectId(target);
                var before = UnityRemoteBridge.InspectObject(id);
                var result = ConnectorDispatch.Invoke("setActive", ProtocolJson.ToJson(new SetActiveRequest
                {
                    projectId = UnityRemoteBridge.ProjectId,
                    objectId = id,
                    active = false,
                    expectedRevision = before.revision
                })) as SetActiveResult;

                Assert.That(result, Is.Not.Null);
                Assert.That(result.objectId, Is.EqualTo(id));
                Assert.That(result.active, Is.False);
                Assert.That(result.revision, Is.EqualTo(before.revision + 1));
                Assert.That(result.sceneDirty, Is.True);
                Assert.That(target.activeSelf, Is.False);
                Assert.That(scene.isDirty, Is.True);
                Assert.That(Undo.GetCurrentGroupName(), Is.EqualTo("Unity Remote: Visibility Target SetActive"));

                // Unity's deferred global hierarchy callback is covered by the connector settle-window tests.
                // This test honestly asserts only the synchronous event owned by UnityRemoteBridge.SetActive.
                Assert.That(changed, Has.Count.EqualTo(1));
                Assert.That(changed[0].type, Is.EqualTo("hierarchyChanged"));
                Assert.That(changed[0].projectId, Is.EqualTo(UnityRemoteBridge.ProjectId));
                Assert.That(changed[0].sceneId, Is.EqualTo(path));
                Assert.That(changed[0].objectId, Is.EqualTo(id));
                Assert.That(changed[0].revision, Is.EqualTo(result.revision));

                var hierarchyNode = FindHierarchyNode(UnityRemoteBridge.CaptureProject().hierarchy, id);
                Assert.That(hierarchyNode, Is.Not.Null);
                Assert.That(hierarchyNode.active, Is.False);

                Undo.PerformUndo();
                Assert.That(target.activeSelf, Is.True);

                var coalescer = new EventCoalescer();
                coalescer.Queue(new ProtocolEvent
                {
                    type = "hierarchyChanged",
                    projectId = UnityRemoteBridge.ProjectId
                });
                coalescer.Queue(changed[0]);

                // The keys deliberately differ. The broker must hold deferred generics because
                // connector-side coalescing cannot identify this pair as one logical mutation.
                var flushed = coalescer.Flush();
                Assert.That(flushed, Has.Length.EqualTo(2));
                Assert.That(string.IsNullOrEmpty(flushed[0].objectId), Is.True);
                Assert.That(flushed[1].objectId, Is.EqualTo(id));
            }
            finally
            {
                UnityRemoteBridge.ObjectRevisionChanged -= handler;
                AssetDatabase.DeleteAsset(path);
            }
        }

        [Test]
        public void SetActiveRejectsStaleExpectedRevision()
        {
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            var target = new GameObject("Stale Visibility Target");
            Directory.CreateDirectory("Assets/Scenes");
            var path = "Assets/Scenes/UnityRemoteSetActiveConflictTest.unity";
            EditorSceneManager.SaveScene(scene, path);
            try
            {
                var id = UnityRemoteBridge.GetGlobalObjectId(target);
                var before = UnityRemoteBridge.InspectObject(id);

                var stale = Assert.Throws<UnityRemoteException>(() => UnityRemoteBridge.SetActive(new SetActiveRequest
                {
                    projectId = UnityRemoteBridge.ProjectId,
                    objectId = id,
                    active = false,
                    expectedRevision = before.revision - 1
                }));

                Assert.That(stale.code, Is.EqualTo("REVISION_CONFLICT"));
                Assert.That(stale.statusCode, Is.EqualTo(409));
                Assert.That(target.activeSelf, Is.True);
            }
            finally
            {
                AssetDatabase.DeleteAsset(path);
            }
        }

        [Test]
        public void SerializesConnectorErrorStatusAndComponentIdentity()
        {
            var hello = ProtocolJson.ToJson(new ConnectorHello { token = "fixture-token" });
            StringAssert.Contains("\"type\": \"hello\"", hello);
            StringAssert.Contains("\"protocolVersion\": 1", hello);
            StringAssert.Contains("\"role\": \"unity\"", hello);

            var error = new UnityRemoteException("SCENE_NOT_SAVED", "The scene has no asset path yet.", 422).ToErrorBody();
            var errorJson = ProtocolJson.ToJson(error);
            StringAssert.Contains("\"code\": \"SCENE_NOT_SAVED\"", errorJson);
            StringAssert.Contains("\"statusCode\": 422", errorJson);

            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            var camera = new GameObject("Main Camera");
            Directory.CreateDirectory("Assets/Scenes");
            var path = "Assets/Scenes/UnityRemoteSerializeTest.unity";
            EditorSceneManager.SaveScene(scene, path);
            try
            {
                var snapshotJson = ProtocolJson.ToJson(UnityRemoteBridge.InspectObject(UnityRemoteBridge.GetGlobalObjectId(camera)));
                StringAssert.Contains("\"id\":", snapshotJson);
                StringAssert.Contains("m_LocalPosition.x", snapshotJson);
                StringAssert.Contains("propertyDisplayNames", snapshotJson);
            }
            finally
            {
                AssetDatabase.DeleteAsset(path);
            }
        }

        [Test]
        public void RejectsStaleRevisionsAndWrongProjectsWithStructuredErrors()
        {
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            var camera = new GameObject("Main Camera");
            Directory.CreateDirectory("Assets/Scenes");
            var path = "Assets/Scenes/UnityRemoteConflictTest.unity";
            EditorSceneManager.SaveScene(scene, path);
            try
            {
                var id = UnityRemoteBridge.GetGlobalObjectId(camera);
                var snapshot = UnityRemoteBridge.InspectObject(id);
                var transform = ComponentOfType(snapshot, "UnityEngine.Transform");

                var stale = Assert.Throws<UnityRemoteException>(() => UnityRemoteBridge.ApplyEdit(new EditRequest
                {
                    projectId = UnityRemoteBridge.ProjectId,
                    objectId = id,
                    componentId = transform.id,
                    property = "m_LocalPosition.x",
                    value = 4f,
                    expectedRevision = 0
                }));
                Assert.That(stale.code, Is.EqualTo("REVISION_CONFLICT"));
                Assert.That(stale.statusCode, Is.EqualTo(409));

                var mismatch = Assert.Throws<UnityRemoteException>(() => UnityRemoteBridge.ApplyEdit(new EditRequest
                {
                    projectId = "project-other",
                    objectId = id,
                    componentId = transform.id,
                    property = "m_LocalPosition.x",
                    value = 4f,
                    expectedRevision = snapshot.revision
                }));
                Assert.That(mismatch.code, Is.EqualTo("PROJECT_MISMATCH"));
            }
            finally
            {
                AssetDatabase.DeleteAsset(path);
            }
        }

        [Test]
        public void RejectsMalformedGlobalObjectIdWithStructuredError()
        {
            var error = Assert.Throws<UnityRemoteException>(() => UnityRemoteBridge.SetTransformPositionX("missing", 4f));
            Assert.That(error.code, Is.EqualTo("INVALID_OBJECT_ID"));
            Assert.That(error.statusCode, Is.EqualTo(400));
        }

        [Test]
        public void SaveSceneRequiresAnAssetPathAndLeavesMutationSeparate()
        {
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            var missing = Assert.Throws<UnityRemoteException>(() => UnityRemoteBridge.SaveScene(new SaveRequest
            {
                projectId = UnityRemoteBridge.ProjectId,
                sceneId = "missing-scene"
            }));
            Assert.That(missing.code, Is.EqualTo("SCENE_NOT_FOUND"));

            var untitledScene = UnityRemoteBridge.CaptureProject().scenes[0];
            Assert.That(untitledScene, Is.Not.Null);
            var untitled = Assert.Throws<UnityRemoteException>(() => UnityRemoteBridge.SaveScene(new SaveRequest
            {
                projectId = UnityRemoteBridge.ProjectId,
                sceneId = untitledScene.id
            }));
            Assert.That(untitled.code, Is.EqualTo("SCENE_NOT_SAVED"));
            Assert.That(untitled.statusCode, Is.EqualTo(422));

            Directory.CreateDirectory("Assets/Scenes");
            var path = "Assets/Scenes/UnityRemoteTest.unity";
            EditorSceneManager.SaveScene(scene, path);
            try
            {
                var result = UnityRemoteBridge.SaveScene(new SaveRequest
                {
                    projectId = UnityRemoteBridge.ProjectId,
                    sceneId = path
                });
                Assert.That(result.dirty, Is.False);
                Assert.That(result.path, Is.EqualTo(path));
            }
            finally
            {
                AssetDatabase.DeleteAsset(path);
            }
        }

        [Test]
        public void CapturesANonemptyIdForAnUntitledScene()
        {
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);

            var snapshot = UnityRemoteBridge.CaptureProject();

            Assert.That(snapshot.scenes, Has.Length.EqualTo(1));
            Assert.That(snapshot.scenes[0].id, Is.Not.Null.And.Not.Empty);
        }

        private static ComponentSnapshot ComponentOfType(ObjectSnapshot snapshot, string type)
        {
            var component = snapshot.components.FirstOrDefault(item => item.type == type);
            Assert.That(component, Is.Not.Null, "missing " + type);
            return component;
        }

        private static HierarchyNode FindHierarchyNode(HierarchyNode[] nodes, string id)
        {
            foreach (var node in nodes)
            {
                if (node.id == id)
                {
                    return node;
                }

                var child = FindHierarchyNode(node.children, id);
                if (child != null)
                {
                    return child;
                }
            }

            return null;
        }
    }
}
