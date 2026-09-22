using System;
using NUnit.Framework;
using UnityEditor;

namespace Islee.UnityRemote.Editor.Tests
{
    public sealed class UnityRemoteConnectorPrefsTests
    {
        private const string BrokerEnvironmentKey = "UNITY_REMOTE_BROKER";
        private const string TokenEnvironmentKey = "UNITY_REMOTE_TOKEN";

        private string brokerEnvironment;
        private string tokenEnvironment;
        private string brokerPreference;
        private string tokenPreference;
        private bool brokerPreferenceExisted;
        private bool tokenPreferenceExisted;

        [SetUp]
        public void ClearEnvironmentAndPreferences()
        {
            brokerEnvironment = Environment.GetEnvironmentVariable(BrokerEnvironmentKey);
            tokenEnvironment = Environment.GetEnvironmentVariable(TokenEnvironmentKey);
            brokerPreferenceExisted = EditorPrefs.HasKey(UnityRemoteConnector.BrokerUrlPreferenceKey);
            tokenPreferenceExisted = EditorPrefs.HasKey(UnityRemoteConnector.TokenPreferenceKey);
            brokerPreference = EditorPrefs.GetString(UnityRemoteConnector.BrokerUrlPreferenceKey, string.Empty);
            tokenPreference = EditorPrefs.GetString(UnityRemoteConnector.TokenPreferenceKey, string.Empty);

            Environment.SetEnvironmentVariable(BrokerEnvironmentKey, null);
            Environment.SetEnvironmentVariable(TokenEnvironmentKey, null);
            EditorPrefs.DeleteKey(UnityRemoteConnector.BrokerUrlPreferenceKey);
            EditorPrefs.DeleteKey(UnityRemoteConnector.TokenPreferenceKey);
        }

        [TearDown]
        public void RestoreEnvironmentAndPreferences()
        {
            Environment.SetEnvironmentVariable(BrokerEnvironmentKey, brokerEnvironment);
            Environment.SetEnvironmentVariable(TokenEnvironmentKey, tokenEnvironment);
            Restore(UnityRemoteConnector.BrokerUrlPreferenceKey, brokerPreference, brokerPreferenceExisted);
            Restore(UnityRemoteConnector.TokenPreferenceKey, tokenPreference, tokenPreferenceExisted);
        }

        [Test]
        public void FallsBackToLoopbackWhenEnvironmentAndPreferenceAreEmpty()
        {
            Assert.That(UnityRemoteConnector.ResolveBrokerUrl(), Is.EqualTo("http://127.0.0.1:4173"));
            Assert.That(UnityRemoteConnector.ConnectorUri().Host, Is.EqualTo("127.0.0.1"));
            Assert.That(UnityRemoteConnector.ConnectorUri().ToString(), Is.EqualTo("ws://127.0.0.1:4173/connector"));
        }

        [Test]
        public void UsesPreferenceBrokerUrlAsWebSocketConnectorUri()
        {
            EditorPrefs.SetString(UnityRemoteConnector.BrokerUrlPreferenceKey, "http://100.64.0.1:4173");

            Assert.That(UnityRemoteConnector.ConnectorUri().ToString(), Is.EqualTo("ws://100.64.0.1:4173/connector"));
        }

        [Test]
        public void PrefersEnvironmentBrokerUrlOverPreferenceAndUpgradesHttpsToWss()
        {
            EditorPrefs.SetString(UnityRemoteConnector.BrokerUrlPreferenceKey, "http://100.64.0.1:4173");
            Environment.SetEnvironmentVariable(BrokerEnvironmentKey, "https://broker.example.test:8443");

            Assert.That(UnityRemoteConnector.ResolveBrokerUrl(), Is.EqualTo("https://broker.example.test:8443"));
            Assert.That(UnityRemoteConnector.ConnectorUri().ToString(), Is.EqualTo("wss://broker.example.test:8443/connector"));
        }

        [Test]
        public void IgnoresBlankPreferenceBrokerUrl()
        {
            EditorPrefs.SetString(UnityRemoteConnector.BrokerUrlPreferenceKey, "   ");

            Assert.That(UnityRemoteConnector.ResolveBrokerUrl(), Is.EqualTo("http://127.0.0.1:4173"));
        }

        [Test]
        public void UsesPreferenceTokenWhenEnvironmentIsUnset()
        {
            EditorPrefs.SetString(UnityRemoteConnector.TokenPreferenceKey, "preference-token-fixture");

            Assert.That(UnityRemoteConnector.ResolveToken(), Is.EqualTo("preference-token-fixture"));
        }

        [Test]
        public void PrefersEnvironmentTokenOverPreferenceToken()
        {
            EditorPrefs.SetString(UnityRemoteConnector.TokenPreferenceKey, "preference-token-fixture");
            Environment.SetEnvironmentVariable(TokenEnvironmentKey, "environment-token-fixture");

            Assert.That(UnityRemoteConnector.ResolveToken(), Is.EqualTo("environment-token-fixture"));
        }

        [Test]
        public void RejectsAssetImportWorkerConnectorEvenWhenItInheritedTheToken()
        {
            Assert.That(
                UnityRemoteConnector.ShouldConnect(
                    "/Applications/Unity/Unity -batchMode -name AssetImportWorkerHW0",
                    true,
                    "inherited-token"),
                Is.False);
        }

        private static void Restore(string key, string value, bool existed)
        {
            if (existed)
            {
                EditorPrefs.SetString(key, value);
                return;
            }

            EditorPrefs.DeleteKey(key);
        }
    }
}
