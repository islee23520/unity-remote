using NUnit.Framework;

namespace Islee.UnityRemote.Editor.Tests
{
    public sealed class UnityRemoteInputTests
    {
        private int injectCalls;
        private GameInput lastInput;

        [SetUp]
        public void InstallSeam()
        {
            injectCalls = 0;
            lastInput = null;
            UnityRemoteInput.Inject = input =>
            {
                injectCalls++;
                lastInput = input;
            };
        }

        [TearDown]
        public void RestoreSeam()
        {
            UnityRemoteInput.ResetSeam();
        }

        [Test]
        public void SendInvokesTheSeamOnceAndReturnsAccepted()
        {
            var input = new GameInput { type = "keyDown", key = "w" };
            var result = UnityRemoteInput.Send(input);

            Assert.That(result.accepted, Is.True);
            Assert.That(injectCalls, Is.EqualTo(1));
            Assert.That(lastInput, Is.SameAs(input));
        }

        [Test]
        public void DispatchSendGameInputReturnsAccepted()
        {
            var result = ConnectorDispatch.Invoke("sendGameInput", "{\"type\":\"mouseMove\",\"x\":0.5,\"y\":0.25}") as InputResult;

            Assert.That(result, Is.Not.Null);
            Assert.That(result.accepted, Is.True);
            Assert.That(injectCalls, Is.EqualTo(1));
            Assert.That(lastInput.type, Is.EqualTo("mouseMove"));
            Assert.That(lastInput.x, Is.EqualTo(0.5).Within(0.0001));
            Assert.That(lastInput.y, Is.EqualTo(0.25).Within(0.0001));
        }

        [Test]
        public void DispatchUnknownMethodIsStillInvalidRequest()
        {
            var error = Assert.Throws<UnityRemoteException>(() => ConnectorDispatch.Invoke("injectPointer", "{}"));

            Assert.That(error.code, Is.EqualTo("INVALID_REQUEST"));
            Assert.That(error.statusCode, Is.EqualTo(400));
            Assert.That(injectCalls, Is.EqualTo(0));
        }
    }
}
