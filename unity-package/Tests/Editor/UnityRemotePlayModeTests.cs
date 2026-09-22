using NUnit.Framework;

namespace Islee.UnityRemote.Editor.Tests
{
    public sealed class UnityRemotePlayModeTests
    {
        private bool fakePlaying;
        private bool fakePlayingOrWillChange;
        private int enterCalls;
        private int exitCalls;

        [SetUp]
        public void InstallSeam()
        {
            fakePlaying = false;
            fakePlayingOrWillChange = false;
            enterCalls = 0;
            exitCalls = 0;

            UnityRemotePlayMode.IsPlaying = () => fakePlaying;
            UnityRemotePlayMode.IsPlayingOrWillChangePlayMode = () => fakePlayingOrWillChange;
            UnityRemotePlayMode.EnterPlayMode = () => enterCalls++;
            UnityRemotePlayMode.ExitPlayMode = () => exitCalls++;
        }

        [TearDown]
        public void RestoreSeam()
        {
            UnityRemotePlayMode.ResetSeam();
        }

        [Test]
        public void GetStateReflectsTheFakeEditorFlags()
        {
            var idle = UnityRemotePlayMode.GetState();
            Assert.That(idle.playing, Is.False);
            Assert.That(idle.transitioning, Is.False);

            fakePlayingOrWillChange = true;
            var entering = UnityRemotePlayMode.GetState();
            Assert.That(entering.playing, Is.False);
            Assert.That(entering.transitioning, Is.True);

            fakePlaying = true;
            var playing = UnityRemotePlayMode.GetState();
            Assert.That(playing.playing, Is.True);
            Assert.That(playing.transitioning, Is.False);
        }

        [Test]
        public void SetPlayingTrueInvokesEnterOnceAndNeverExit()
        {
            var state = UnityRemotePlayMode.SetPlaying(true);

            Assert.That(enterCalls, Is.EqualTo(1));
            Assert.That(exitCalls, Is.EqualTo(0));
            Assert.That(state.playing, Is.False, "state is read back from the seam getters, not assumed from the action");
        }

        [Test]
        public void SetPlayingFalseInvokesExitOnceAndNeverEnter()
        {
            fakePlaying = true;
            fakePlayingOrWillChange = true;

            var state = UnityRemotePlayMode.SetPlaying(false);

            Assert.That(exitCalls, Is.EqualTo(1));
            Assert.That(enterCalls, Is.EqualTo(0));
            Assert.That(state.playing, Is.True);
        }

        [Test]
        public void DispatchGetPlayStateReturnsSeamState()
        {
            fakePlaying = true;
            fakePlayingOrWillChange = true;

            var state = ConnectorDispatch.Invoke("getPlayState", "{}") as PlayState;

            Assert.That(state, Is.Not.Null);
            Assert.That(state.playing, Is.True);
            Assert.That(state.transitioning, Is.False);
        }

        [Test]
        public void DispatchSetPlayModeEntersAndReturnsState()
        {
            var state = ConnectorDispatch.Invoke("setPlayMode", "{\"playing\": true}") as PlayState;

            Assert.That(enterCalls, Is.EqualTo(1));
            Assert.That(exitCalls, Is.EqualTo(0));
            Assert.That(state, Is.Not.Null);
        }

        [Test]
        public void DispatchSetPlayModeWithoutPlayingIsInvalidRequest()
        {
            var error = Assert.Throws<UnityRemoteException>(() => ConnectorDispatch.Invoke("setPlayMode", "{}"));

            Assert.That(error.code, Is.EqualTo("INVALID_REQUEST"));
            Assert.That(error.statusCode, Is.EqualTo(400));
            Assert.That(enterCalls, Is.EqualTo(0));
            Assert.That(exitCalls, Is.EqualTo(0));
        }

        [Test]
        public void DispatchUnknownMethodIsStillInvalidRequest()
        {
            var error = Assert.Throws<UnityRemoteException>(() => ConnectorDispatch.Invoke("captureGameView", "{}"));

            Assert.That(error.code, Is.EqualTo("INVALID_REQUEST"));
            Assert.That(error.statusCode, Is.EqualTo(400));
        }
    }
}
