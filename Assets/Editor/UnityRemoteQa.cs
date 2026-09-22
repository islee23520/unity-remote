using System;
using System.IO;
using Islee.UnityRemote.Editor;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

public static class UnityRemoteQa
{
    public static void CreateSceneAndRunBridge()
    {
        var scene = EditorSceneManager.NewScene(NewSceneSetup.DefaultGameObjects, NewSceneMode.Single);
        var camera = GameObject.Find("Main Camera") ?? throw new InvalidOperationException("Main Camera was not created.");
        camera.transform.position = new Vector3(0f, 3f, -10f);
        camera.transform.rotation = Quaternion.Euler(10f, 0f, 0f);
        camera.GetComponent<Camera>().backgroundColor = new Color(0.035f, 0.05f, 0.08f);
        var player = GameObject.CreatePrimitive(PrimitiveType.Capsule);
        player.name = "Player";
        player.transform.position = new Vector3(4f, 0f, 0f);
        var playerRenderer = player.GetComponent<Renderer>();
        playerRenderer.sharedMaterial = new Material(Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Standard"));
        playerRenderer.sharedMaterial.color = new Color(0.12f, 0.55f, 1f);

        var marker = GameObject.CreatePrimitive(PrimitiveType.Cube);
        marker.name = "Camera X Marker";
        marker.transform.position = new Vector3(4f, 0f, 2f);
        marker.transform.localScale = new Vector3(2.5f, 0.15f, 0.15f);
        var markerRenderer = marker.GetComponent<Renderer>();
        markerRenderer.sharedMaterial = new Material(Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Standard"));
        markerRenderer.sharedMaterial.color = new Color(1f, 0.55f, 0.12f);

        var label = new GameObject("QA Label");
        var text = label.AddComponent<TextMesh>();
        text.text = "UNITY REMOTE\nCAMERA X = 4\nBRIDGE EDIT APPLIED";
        text.fontSize = 42;
        text.characterSize = 0.055f;
        text.anchor = TextAnchor.MiddleCenter;
        text.alignment = TextAlignment.Center;
        text.color = Color.white;
        label.transform.position = new Vector3(4f, 2.1f, 1f);

        Directory.CreateDirectory("Assets/Scenes");
        EditorSceneManager.SaveScene(scene, "Assets/Scenes/Main.unity");

        var id = UnityRemoteBridge.GetGlobalObjectId(camera);
        var result = UnityRemoteBridge.SetTransformPositionX(id, 4f);
        File.WriteAllText(".omo/evidence/unity-bridge-result.json", ProtocolJson.ToJson(result));
        File.WriteAllText(".omo/evidence/unity-project-context.json", UnityRemoteBridge.CaptureProjectJson());
        EditorSceneManager.SaveScene(scene);

        EditorApplication.EnterPlaymode();
    }
}
