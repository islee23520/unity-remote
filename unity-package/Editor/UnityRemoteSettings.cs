using UnityEditor;
using UnityEngine;

namespace Islee.UnityRemote.Editor
{
    internal static class UnityRemoteSettings
    {
        [SettingsProvider]
        public static SettingsProvider CreateProvider()
        {
            return new SettingsProvider("Preferences/Unity Remote", SettingsScope.User)
            {
                label = "Unity Remote",
                keywords = new[] { "unity", "remote", "broker", "token", "connector" },
                guiHandler = _ => Draw()
            };
        }

        private static void Draw()
        {
            EditorGUILayout.HelpBox(
                "Leave a field empty to fall back to its environment variable "
                + "(UNITY_REMOTE_BROKER / UNITY_REMOTE_TOKEN), then to "
                + UnityRemoteConnector.DefaultBrokerUrl + " for the broker and the "
                + ".unity-remote-token file beside Assets for the token.",
                MessageType.Info);

            EditorGUIUtility.labelWidth = 140f;
            DrawPreference("Broker URL", UnityRemoteConnector.BrokerUrlPreferenceKey);
            DrawPreference("Session Token", UnityRemoteConnector.TokenPreferenceKey);

            EditorGUILayout.Space();
            EditorGUILayout.LabelField("Resolved broker", UnityRemoteConnector.ConnectorUri().ToString());
        }

        private static void DrawPreference(string label, string key)
        {
            var stored = EditorPrefs.GetString(key, string.Empty);
            var edited = EditorGUILayout.TextField(label, stored);
            if (edited != stored)
            {
                EditorPrefs.SetString(key, edited);
            }
        }
    }
}
