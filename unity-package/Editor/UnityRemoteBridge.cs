using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace Islee.UnityRemote.Editor
{
    public static class UnityRemoteBridge
    {
        private static readonly Dictionary<string, int> ObjectRevisions = new Dictionary<string, int>();
        private static readonly Dictionary<string, int> SceneRevisions = new Dictionary<string, int>();
        private static readonly Dictionary<string, string> ObjectFingerprints = new Dictionary<string, string>();
        private static readonly HashSet<string> BumpedThisFlush = new HashSet<string>();
        private static bool hooksInstalled;
        private static int suppressExternalBumps;

        public static event Action<ProtocolEvent> ObjectRevisionChanged;

        internal static bool IsSuppressingExternalEvents
        {
            get { return suppressExternalBumps > 0; }
        }

        public static string ProjectId
        {
            get { return "unity-" + StableHash(Application.dataPath); }
        }

        public static string CaptureProjectJson()
        {
            return ProtocolJson.ToJson(CaptureProject());
        }

        public static ProjectSnapshot CaptureProject()
        {
            EnsureRevisionHooks();
            var scenes = new List<SceneSummary>();
            var hierarchy = new List<HierarchyNode>();
            for (var index = 0; index < SceneManager.sceneCount; index++)
            {
                var scene = SceneManager.GetSceneAt(index);
                var sceneId = SceneId(scene);
                var summary = new SceneSummary
                {
                    id = sceneId,
                    name = string.IsNullOrEmpty(scene.name) ? "Untitled" : scene.name,
                    path = scene.path ?? string.Empty,
                    loaded = scene.isLoaded,
                    dirty = scene.isDirty,
                    revision = GetRevision(SceneRevisions, sceneId)
                };
                scenes.Add(summary);
                hierarchy.Add(new HierarchyNode
                {
                    id = "scene:" + sceneId,
                    name = summary.name,
                    active = scene.isLoaded,
                    children = scene.GetRootGameObjects().Select(CaptureNode).ToArray()
                });
            }

            return new ProjectSnapshot
            {
                project = new ProjectSummary
                {
                    id = ProjectId,
                    name = string.IsNullOrEmpty(Application.productName) ? "Unity Project" : Application.productName,
                    unityVersion = Application.unityVersion,
                    connected = true,
                    source = "unity",
                    protocolVersion = Protocol.Version,
                    assetRoots = new[]
                    {
                        new AssetRoot { name = "Assets", path = "Assets" },
                        new AssetRoot { name = "Packages", path = "Packages" }
                    }
                },
                scenes = scenes.ToArray(),
                hierarchy = hierarchy.ToArray()
            };
        }

        public static ObjectSnapshot InspectObject(string objectId, string projectId = null)
        {
            EnsureRevisionHooks();
            AssertProject(projectId);
            var gameObject = ResolveGameObject(objectId);
            return CaptureObjectSnapshot(gameObject);
        }

        public static EditPreview PreviewEdit(EditRequest request)
        {
            var resolved = ResolveEditable(request);
            return new EditPreview
            {
                preview = true,
                projectId = ProjectId,
                objectId = resolved.gameObject == null ? request.objectId : GetGlobalObjectId(resolved.gameObject),
                componentId = request.componentId,
                property = request.property,
                expectedRevision = request.expectedRevision,
                before = resolved.before,
                after = NormalizeValue(request.value, resolved.before),
                undoGroup = UndoGroupName(resolved.gameObject.name, request.property)
            };
        }

        public static EditResult ApplyEdit(EditRequest request)
        {
            var resolved = ResolveEditable(request);
            var gameObject = resolved.gameObject;
            var undoGroup = UndoGroupName(gameObject.name, request.property);
            var nextValue = NormalizeValue(request.value, resolved.before);

            suppressExternalBumps++;
            try
            {
                Undo.IncrementCurrentGroup();
                Undo.SetCurrentGroupName(undoGroup);
                var group = Undo.GetCurrentGroup();
                WriteProperty(resolved.component, request.property, nextValue, undoGroup);
                EditorSceneManager.MarkSceneDirty(gameObject.scene);
                Undo.CollapseUndoOperations(group);

                Bump(ObjectRevisions, GetGlobalObjectId(gameObject));
                Bump(SceneRevisions, SceneId(gameObject.scene));
            }
            finally
            {
                suppressExternalBumps = Math.Max(0, suppressExternalBumps - 1);
            }

            var snapshot = CaptureObjectSnapshot(gameObject, false);
            var after = ReadProperty(snapshot, request.componentId, request.property);
            return new EditResult
            {
                transactionId = "tx-" + snapshot.revision,
                undoGroup = undoGroup,
                @object = snapshot,
                before = resolved.before,
                after = after,
                sceneDirty = gameObject.scene.isDirty
            };
        }

        public static EditResult SetTransformPositionX(string globalObjectId, float value)
        {
            var snapshot = InspectObject(globalObjectId);
            var transform = snapshot.components.FirstOrDefault(item => item.type == "UnityEngine.Transform")
                ?? throw new UnityRemoteException("COMPONENT_NOT_FOUND", "Transform was not found.", 404);
            return ApplyEdit(new EditRequest
            {
                projectId = ProjectId,
                objectId = globalObjectId,
                componentId = transform.id,
                property = "m_LocalPosition.x",
                value = value,
                expectedRevision = snapshot.revision
            });
        }

        public static SetActiveResult SetActive(SetActiveRequest request)
        {
            AssertProject(request.projectId);
            var gameObject = ResolveGameObject(request.objectId);
            var before = InspectObject(request.objectId, request.projectId);
            if (before.revision != request.expectedRevision)
            {
                throw new UnityRemoteException(
                    "REVISION_CONFLICT",
                    $"Expected revision {request.expectedRevision}, but object is at revision {before.revision}.",
                    409,
                    new Dictionary<string, object>
                    {
                        { "expectedRevision", request.expectedRevision },
                        { "actualRevision", before.revision },
                        { "objectId", before.id }
                    });
            }

            var objectId = before.id;
            var sceneId = SceneId(gameObject.scene);
            suppressExternalBumps++;
            try
            {
                Undo.IncrementCurrentGroup();
                Undo.SetCurrentGroupName("Unity Remote: " + gameObject.name + " SetActive");
                var group = Undo.GetCurrentGroup();
                Undo.RecordObject(gameObject, "Unity Remote: " + gameObject.name + " SetActive");
                gameObject.SetActive(request.active);
                EditorSceneManager.MarkSceneDirty(gameObject.scene);
                Undo.CollapseUndoOperations(group);

                Bump(ObjectRevisions, objectId);
                Bump(SceneRevisions, sceneId);
            }
            finally
            {
                suppressExternalBumps = Math.Max(0, suppressExternalBumps - 1);
            }

            var after = InspectObject(objectId, request.projectId);
            ObjectRevisionChanged?.Invoke(new ProtocolEvent
            {
                type = "hierarchyChanged",
                projectId = ProjectId,
                sceneId = sceneId,
                objectId = objectId,
                revision = after.revision
            });
            return new SetActiveResult
            {
                objectId = after.id,
                active = after.active,
                revision = after.revision,
                sceneDirty = gameObject.scene.isDirty
            };
        }

        public static SaveResult SaveScene(SaveRequest request)
        {
            AssertProject(request.projectId);
            var scene = FindScene(request.sceneId);
            if (!scene.IsValid() || !scene.isLoaded)
            {
                throw new UnityRemoteException("SCENE_NOT_FOUND", $"Scene '{request.sceneId}' was not found.", 404, new Dictionary<string, object> { { "sceneId", request.sceneId } });
            }

            if (string.IsNullOrEmpty(scene.path))
            {
                throw new UnityRemoteException("SCENE_NOT_SAVED", "The scene has no asset path yet.", 422, new Dictionary<string, object> { { "sceneId", request.sceneId } });
            }

            EditorSceneManager.SaveScene(scene);
            return new SaveResult
            {
                sceneId = SceneId(scene),
                path = scene.path,
                dirty = false,
                revision = GetRevision(SceneRevisions, SceneId(scene))
            };
        }

        public static UnityContext CreateContext(IEnumerable<string> objectIds, string projectId = null)
        {
            var snapshot = CaptureProject();
            AssertProject(projectId);
            return new UnityContext
            {
                kind = "unity-project-context",
                generatedAt = DateTime.UtcNow.ToString("o"),
                project = snapshot.project,
                scenes = snapshot.scenes,
                hierarchy = snapshot.hierarchy,
                objects = (objectIds ?? Array.Empty<string>()).Select(id => InspectObject(id, projectId)).ToArray()
            };
        }

        public static string GetGlobalObjectId(GameObject gameObject)
        {
            return GlobalObjectId.GetGlobalObjectIdSlow(gameObject).ToString();
        }

        public static string GetComponentId(Component component)
        {
            return GlobalObjectId.GetGlobalObjectIdSlow(component).ToString();
        }

        public static void BumpTrackedRevisions()
        {
            foreach (var key in ObjectRevisions.Keys.ToList())
            {
                ObjectRevisions[key] = ObjectRevisions[key] + 1;
            }
        }

        private static void EnsureRevisionHooks()
        {
            if (hooksInstalled)
            {
                return;
            }

            Undo.undoRedoPerformed += BumpTrackedRevisions;
            Undo.postprocessModifications += OnPostprocessModifications;
            ObjectChangeEvents.changesPublished += OnObjectChangesPublished;
            EditorApplication.update += FlushBumpWindow;
            hooksInstalled = true;
        }

        private static void FlushBumpWindow()
        {
            BumpedThisFlush.Clear();
        }

        private static UndoPropertyModification[] OnPostprocessModifications(UndoPropertyModification[] modifications)
        {
            if (suppressExternalBumps > 0)
            {
                return modifications;
            }

            foreach (var modification in modifications)
            {
                var target = modification.currentValue.target;
                var gameObject = GameObjectFromUnityObject(target);
                if (gameObject != null)
                {
                    NoteExternalChange(gameObject);
                }
            }

            return modifications;
        }

        private static void OnObjectChangesPublished(ref ObjectChangeEventStream stream)
        {
            if (suppressExternalBumps > 0)
            {
                return;
            }

            for (var index = 0; index < stream.length; index++)
            {
                EntityId entityId;
                switch (stream.GetEventType(index))
                {
                    case ObjectChangeKind.ChangeGameObjectOrComponentProperties:
                        stream.GetChangeGameObjectOrComponentPropertiesEvent(index, out var properties);
                        entityId = properties.entityId;
                        break;
                    case ObjectChangeKind.ChangeGameObjectStructure:
                        stream.GetChangeGameObjectStructureEvent(index, out var structure);
                        entityId = structure.entityId;
                        break;
                    default:
                        continue;
                }

                var gameObject = GameObjectFromUnityObject(EditorUtility.EntityIdToObject(entityId));
                if (gameObject != null)
                {
                    NoteExternalChange(gameObject);
                }
            }
        }

        private static GameObject GameObjectFromUnityObject(UnityEngine.Object target)
        {
            if (target is GameObject gameObject)
            {
                return gameObject;
            }

            if (target is Component component)
            {
                return component.gameObject;
            }

            return null;
        }

        private static void NoteExternalChange(GameObject gameObject)
        {
            var objectId = GetGlobalObjectId(gameObject);
            if (!BumpedThisFlush.Add(objectId))
            {
                return;
            }

            Bump(ObjectRevisions, objectId);
            Bump(SceneRevisions, SceneId(gameObject.scene));
            ObjectRevisionChanged?.Invoke(new ProtocolEvent
            {
                type = "propertyChanged",
                projectId = ProjectId,
                sceneId = SceneId(gameObject.scene),
                objectId = objectId,
                revision = GetRevision(ObjectRevisions, objectId)
            });
        }

        private static HierarchyNode CaptureNode(GameObject gameObject)
        {
            var children = new HierarchyNode[gameObject.transform.childCount];
            for (var index = 0; index < gameObject.transform.childCount; index++)
            {
                children[index] = CaptureNode(gameObject.transform.GetChild(index).gameObject);
            }

            return new HierarchyNode
            {
                id = GetGlobalObjectId(gameObject),
                name = gameObject.name,
                active = gameObject.activeSelf,
                children = children
            };
        }

        private static ObjectSnapshot CaptureObjectSnapshot(GameObject gameObject, bool bumpOnFingerprintChange = true)
        {
            var id = GetGlobalObjectId(gameObject);
            var components = CaptureComponents(gameObject);
            var fingerprint = Fingerprint(components);
            if (bumpOnFingerprintChange &&
                ObjectFingerprints.TryGetValue(id, out var previous) &&
                previous != fingerprint)
            {
                Bump(ObjectRevisions, id);
                Bump(SceneRevisions, SceneId(gameObject.scene));
            }

            ObjectFingerprints[id] = fingerprint;
            return new ObjectSnapshot
            {
                id = id,
                sceneId = SceneId(gameObject.scene),
                name = gameObject.name,
                active = gameObject.activeSelf,
                revision = GetRevision(ObjectRevisions, id),
                components = components
            };
        }

        private static string Fingerprint(ComponentSnapshot[] components)
        {
            var builder = new StringBuilder();
            foreach (var component in components.OrderBy(item => item.id, StringComparer.Ordinal))
            {
                builder.Append(component.id).Append('\n');
                foreach (var key in component.properties.Keys.OrderBy(item => item, StringComparer.Ordinal))
                {
                    builder.Append(key).Append('=').Append(Convert.ToString(component.properties[key], CultureInfo.InvariantCulture)).Append('\n');
                }
            }

            return builder.ToString();
        }

        private static ComponentSnapshot[] CaptureComponents(GameObject gameObject)
        {
            var snapshots = new List<ComponentSnapshot> { CaptureTransform(gameObject.transform) };
            foreach (var component in gameObject.GetComponents<Component>())
            {
                if (component == null || component is Transform)
                {
                    continue;
                }

                var snapshot = CaptureSerializedComponent(component);
                if (snapshot != null)
                {
                    snapshots.Add(snapshot);
                }
            }

            return snapshots.ToArray();
        }

        private static ComponentSnapshot CaptureTransform(Transform transform)
        {
            var position = transform.localPosition;
            var euler = transform.localEulerAngles;
            var properties = new Dictionary<string, object>
            {
                { "m_LocalPosition.x", Round(position.x) },
                { "m_LocalPosition.y", Round(position.y) },
                { "m_LocalPosition.z", Round(position.z) },
                { "m_LocalEulerAnglesHint.x", Round(euler.x) },
                { "m_LocalEulerAnglesHint.y", Round(euler.y) },
                { "m_LocalEulerAnglesHint.z", Round(euler.z) }
            };
            return new ComponentSnapshot
            {
                id = GetComponentId(transform),
                type = "UnityEngine.Transform",
                properties = properties,
                editableProperties = properties.Keys.ToArray(),
                propertyDisplayNames = new Dictionary<string, string>
                {
                    { "m_LocalPosition.x", "Position X" },
                    { "m_LocalPosition.y", "Position Y" },
                    { "m_LocalPosition.z", "Position Z" },
                    { "m_LocalEulerAnglesHint.x", "Rotation X" },
                    { "m_LocalEulerAnglesHint.y", "Rotation Y" },
                    { "m_LocalEulerAnglesHint.z", "Rotation Z" }
                }
            };
        }

        private static ComponentSnapshot CaptureSerializedComponent(Component component)
        {
            var properties = new Dictionary<string, object>();
            var labels = new Dictionary<string, string>();
            var editable = new List<string>();
            var serialized = new SerializedObject(component);
            var iterator = serialized.GetIterator();
            var enterChildren = true;
            while (iterator.NextVisible(enterChildren))
            {
                enterChildren = false;
                if (iterator.propertyPath == "m_Script")
                {
                    continue;
                }

                if (iterator.propertyType == SerializedPropertyType.Vector3)
                {
                    foreach (var axis in new[] { "x", "y", "z" })
                    {
                        var child = iterator.FindPropertyRelative(axis);
                        if (child == null)
                        {
                            continue;
                        }

                        AdvertiseScalar(child, iterator.displayName + " " + axis.ToUpperInvariant(), properties, labels, editable);
                    }

                    continue;
                }

                AdvertiseScalar(iterator, iterator.displayName, properties, labels, editable);
            }

            return new ComponentSnapshot
            {
                id = GetComponentId(component),
                type = component.GetType().FullName,
                properties = properties,
                editableProperties = editable.ToArray(),
                propertyDisplayNames = labels
            };
        }

        private static void AdvertiseScalar(
            SerializedProperty property,
            string displayName,
            Dictionary<string, object> properties,
            Dictionary<string, string> labels,
            List<string> editable)
        {
            object value;
            switch (property.propertyType)
            {
                case SerializedPropertyType.Float:
                    value = Round(property.floatValue);
                    break;
                case SerializedPropertyType.Integer:
                    value = property.intValue;
                    break;
                case SerializedPropertyType.Boolean:
                    value = property.boolValue;
                    break;
                case SerializedPropertyType.String:
                    value = property.stringValue;
                    break;
                case SerializedPropertyType.Color:
                    value = "#" + ColorUtility.ToHtmlStringRGB(property.colorValue);
                    break;
                default:
                    return;
            }

            properties[property.propertyPath] = value;
            labels[property.propertyPath] = displayName;
            editable.Add(property.propertyPath);
        }

        private struct ResolvedEdit
        {
            public GameObject gameObject;
            public Component component;
            public object before;
        }

        private static ResolvedEdit ResolveEditable(EditRequest request)
        {
            AssertProject(request.projectId);
            var gameObject = ResolveGameObject(request.objectId);
            var snapshot = CaptureObjectSnapshot(gameObject);
            if (snapshot.revision != request.expectedRevision)
            {
                throw new UnityRemoteException(
                    "REVISION_CONFLICT",
                    $"Expected revision {request.expectedRevision}, but object is at revision {snapshot.revision}.",
                    409,
                    new Dictionary<string, object>
                    {
                        { "expectedRevision", request.expectedRevision },
                        { "actualRevision", snapshot.revision },
                        { "objectId", snapshot.id }
                    });
            }

            var component = ResolveComponent(gameObject, request.componentId);
            var before = ReadProperty(snapshot, request.componentId, request.property);
            return new ResolvedEdit { gameObject = gameObject, component = component, before = before };
        }

        private static Component ResolveComponent(GameObject gameObject, string componentId)
        {
            foreach (var component in gameObject.GetComponents<Component>())
            {
                if (component != null && GetComponentId(component) == componentId)
                {
                    return component;
                }
            }

            throw new UnityRemoteException(
                "COMPONENT_NOT_FOUND",
                $"Component '{componentId}' was not found.",
                404,
                new Dictionary<string, object> { { "componentId", componentId } });
        }

        private static object ReadProperty(ObjectSnapshot snapshot, string componentId, string property)
        {
            var component = snapshot.components.FirstOrDefault(item => item.id == componentId);
            if (component == null)
            {
                throw new UnityRemoteException(
                    "COMPONENT_NOT_FOUND",
                    $"Component '{componentId}' was not found.",
                    404,
                    new Dictionary<string, object> { { "componentId", componentId } });
            }

            if (Array.IndexOf(component.editableProperties, property) < 0)
            {
                throw new UnityRemoteException(
                    "PROPERTY_NOT_EDITABLE",
                    $"Property '{componentId}.{property}' is not editable.",
                    422,
                    new Dictionary<string, object> { { "componentId", componentId }, { "property", property } });
            }

            if (!component.properties.TryGetValue(property, out var value))
            {
                throw new UnityRemoteException(
                    "PROPERTY_NOT_FOUND",
                    $"Property '{componentId}.{property}' was not found.",
                    404,
                    new Dictionary<string, object> { { "componentId", componentId }, { "property", property } });
            }

            return value;
        }

        private static void WriteProperty(Component component, string propertyPath, object value, string undoGroup)
        {
            Undo.RecordObject(component, undoGroup);
            var serialized = new SerializedObject(component);
            var target = serialized.FindProperty(propertyPath);
            if (target == null)
            {
                throw new UnityRemoteException("PROPERTY_NOT_FOUND", $"Property '{propertyPath}' was not found.", 404, new Dictionary<string, object> { { "property", propertyPath } });
            }

            switch (target.propertyType)
            {
                case SerializedPropertyType.Float:
                    target.floatValue = Convert.ToSingle(value, CultureInfo.InvariantCulture);
                    break;
                case SerializedPropertyType.Integer:
                    target.intValue = Convert.ToInt32(value, CultureInfo.InvariantCulture);
                    break;
                case SerializedPropertyType.Boolean:
                    target.boolValue = Convert.ToBoolean(value, CultureInfo.InvariantCulture);
                    break;
                case SerializedPropertyType.String:
                    target.stringValue = Convert.ToString(value, CultureInfo.InvariantCulture);
                    break;
                case SerializedPropertyType.Color:
                    if (!ColorUtility.TryParseHtmlString(Convert.ToString(value, CultureInfo.InvariantCulture), out var color))
                    {
                        throw new UnityRemoteException("INVALID_REQUEST", "Color values must be #RRGGBB.", 400);
                    }

                    target.colorValue = color;
                    break;
                default:
                    throw new UnityRemoteException("PROPERTY_NOT_EDITABLE", $"Property '{propertyPath}' is not editable.", 422);
            }

            serialized.ApplyModifiedProperties();
        }

        private static GameObject ResolveGameObject(string objectId)
        {
            if (!GlobalObjectId.TryParse(objectId, out var parsedId))
            {
                throw new UnityRemoteException("INVALID_OBJECT_ID", "The supplied GlobalObjectId is invalid.", 400, new Dictionary<string, object> { { "objectId", objectId } });
            }

            var resolved = GlobalObjectId.GlobalObjectIdentifierToObjectSlow(parsedId) as GameObject;
            if (resolved == null)
            {
                throw new UnityRemoteException("OBJECT_NOT_FOUND", $"Object '{objectId}' was not found.", 404, new Dictionary<string, object> { { "objectId", objectId } });
            }

            return resolved;
        }

        private static void AssertProject(string projectId)
        {
            if (!string.IsNullOrEmpty(projectId) && projectId != ProjectId)
            {
                throw new UnityRemoteException(
                    "PROJECT_MISMATCH",
                    $"Project '{projectId}' is not the connected project '{ProjectId}'.",
                    409,
                    new Dictionary<string, object> { { "projectId", projectId }, { "actualProjectId", ProjectId } });
            }
        }

        private static Scene FindScene(string sceneId)
        {
            for (var index = 0; index < SceneManager.sceneCount; index++)
            {
                var scene = SceneManager.GetSceneAt(index);
                if (SceneId(scene) == sceneId)
                {
                    return scene;
                }
            }

            return default;
        }

        private static string SceneId(Scene scene)
        {
            if (!string.IsNullOrEmpty(scene.path))
            {
                return scene.path;
            }

            return string.IsNullOrEmpty(scene.name) ? "untitled:" + scene.handle : scene.name;
        }

        private static int GetRevision(Dictionary<string, int> map, string key)
        {
            if (!map.TryGetValue(key, out var revision))
            {
                revision = 1;
                map[key] = revision;
            }

            return revision;
        }

        private static void Bump(Dictionary<string, int> map, string key)
        {
            map[key] = GetRevision(map, key) + 1;
        }

        private static object NormalizeValue(object value, object before)
        {
            if (before is float || before is double)
            {
                return Convert.ToSingle(value, CultureInfo.InvariantCulture);
            }

            if (before is int || before is long)
            {
                return Convert.ToInt32(value, CultureInfo.InvariantCulture);
            }

            if (before is bool)
            {
                return Convert.ToBoolean(value, CultureInfo.InvariantCulture);
            }

            return value;
        }

        private static float Round(float value)
        {
            return (float)Math.Round(value, 5);
        }

        private static string UndoGroupName(string objectName, string property)
        {
            return $"Unity Remote: {objectName} {property}";
        }

        private static string StableHash(string value)
        {
            using (var sha = SHA256.Create())
            {
                var bytes = sha.ComputeHash(Encoding.UTF8.GetBytes(value));
                var builder = new StringBuilder(12);
                for (var index = 0; index < 6; index++)
                {
                    builder.Append(bytes[index].ToString("x2"));
                }

                return builder.ToString();
            }
        }
    }
}
