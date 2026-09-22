using System;
using UnityEditor;

namespace Islee.UnityRemote.Editor
{
    /// <summary>
    /// Play Mode access behind swappable delegates so EditMode tests can exercise the
    /// contract without entering real Play Mode (which would trigger a domain reload).
    /// </summary>
    public static class UnityRemotePlayMode
    {
        public static Func<bool> IsPlaying = DefaultIsPlaying;
        public static Func<bool> IsPlayingOrWillChangePlayMode = DefaultIsPlayingOrWillChangePlayMode;
        public static Action EnterPlayMode = DefaultEnterPlayMode;
        public static Action ExitPlayMode = DefaultExitPlayMode;

        public static PlayState GetState()
        {
            var playing = IsPlaying();
            return new PlayState
            {
                playing = playing,
                transitioning = IsPlayingOrWillChangePlayMode() != playing
            };
        }

        public static PlayState SetPlaying(bool playing)
        {
            if (playing)
            {
                EnterPlayMode();
            }
            else
            {
                ExitPlayMode();
            }

            return GetState();
        }

        public static void ResetSeam()
        {
            IsPlaying = DefaultIsPlaying;
            IsPlayingOrWillChangePlayMode = DefaultIsPlayingOrWillChangePlayMode;
            EnterPlayMode = DefaultEnterPlayMode;
            ExitPlayMode = DefaultExitPlayMode;
        }

        private static bool DefaultIsPlaying()
        {
            return EditorApplication.isPlaying;
        }

        private static bool DefaultIsPlayingOrWillChangePlayMode()
        {
            return EditorApplication.isPlayingOrWillChangePlaymode;
        }

        private static void DefaultEnterPlayMode()
        {
            EditorApplication.EnterPlaymode();
        }

        private static void DefaultExitPlayMode()
        {
            EditorApplication.ExitPlaymode();
        }
    }
}
