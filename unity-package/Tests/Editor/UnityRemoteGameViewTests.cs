using NUnit.Framework;

namespace Islee.UnityRemote.Editor.Tests
{
    public sealed class UnityRemoteGameViewTests
    {
        private int captureCalls;
        private GameViewFrame seamFrame;

        [SetUp]
        public void InstallSeam()
        {
            captureCalls = 0;
            seamFrame = new GameViewFrame
            {
                mimeType = "image/jpeg",
                data = "ZmFrZWpwZWc",
                width = 8,
                height = 8
            };
            UnityRemoteGameView.Capture = () =>
            {
                captureCalls++;
                return seamFrame;
            };
        }

        [TearDown]
        public void RestoreSeam()
        {
            UnityRemoteGameView.ResetSeam();
        }

        [Test]
        public void GetFrameReturnsTheInjectedSeamFrame()
        {
            var frame = UnityRemoteGameView.GetFrame();

            Assert.That(frame, Is.SameAs(seamFrame));
            Assert.That(frame.mimeType, Is.EqualTo("image/jpeg"));
            Assert.That(frame.data, Is.EqualTo("ZmFrZWpwZWc"));
            Assert.That(frame.width, Is.EqualTo(8));
            Assert.That(frame.height, Is.EqualTo(8));
        }

        [Test]
        public void CaptureIsInvokedOncePerGetFrame()
        {
            UnityRemoteGameView.GetFrame();
            UnityRemoteGameView.GetFrame();

            Assert.That(captureCalls, Is.EqualTo(2));
            UnityRemoteGameView.GetFrame();
            Assert.That(captureCalls, Is.EqualTo(3));
        }

        [Test]
        public void DispatchGetGameViewFrameReturnsTheSeamFrame()
        {
            var frame = ConnectorDispatch.Invoke("getGameViewFrame", "{}") as GameViewFrame;

            Assert.That(frame, Is.Not.Null);
            Assert.That(frame, Is.SameAs(seamFrame));
            Assert.That(captureCalls, Is.EqualTo(1));
        }

        [Test]
        public void DispatchUnknownMethodIsStillInvalidRequest()
        {
            var error = Assert.Throws<UnityRemoteException>(() => ConnectorDispatch.Invoke("notAGameViewMethod", "{}"));

            Assert.That(error.code, Is.EqualTo("INVALID_REQUEST"));
            Assert.That(error.statusCode, Is.EqualTo(400));
            Assert.That(captureCalls, Is.EqualTo(0));
        }
    }
}
