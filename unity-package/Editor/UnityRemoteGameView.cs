using System;
using UnityEngine;

namespace Islee.UnityRemote.Editor
{
    public static class UnityRemoteGameView
    {
        public static Func<GameViewFrame> Capture = CaptureDefault;

        public static GameViewFrame GetFrame()
        {
            return Capture();
        }

        public static void ResetSeam()
        {
            Capture = CaptureDefault;
        }

        private static GameViewFrame CaptureDefault()
        {
            var camera = Camera.main;
            if (camera == null && Camera.allCamerasCount > 0)
            {
                camera = Camera.allCameras[0];
            }

            if (camera == null)
            {
                throw new UnityRemoteException("UNITY_ERROR", "Game View capture requires a camera.", 502);
            }

            var aspect = camera.aspect;
            if (aspect <= 0f || float.IsNaN(aspect) || float.IsInfinity(aspect))
            {
                aspect = 16f / 9f;
            }

            var width = 640;
            var height = Mathf.Max(1, Mathf.RoundToInt(width / aspect));
            RenderTexture rt = null;
            Texture2D texture = null;
            var previousTarget = camera.targetTexture;
            var previousActive = RenderTexture.active;
            try
            {
                rt = RenderTexture.GetTemporary(width, height, 24);
                camera.targetTexture = rt;
                camera.Render();
                RenderTexture.active = rt;
                texture = new Texture2D(width, height, TextureFormat.RGB24, false);
                texture.ReadPixels(new Rect(0, 0, width, height), 0, 0);
                texture.Apply();
                var jpeg = texture.EncodeToJPG(50);
                return new GameViewFrame
                {
                    mimeType = "image/jpeg",
                    data = Convert.ToBase64String(jpeg),
                    width = texture.width,
                    height = texture.height
                };
            }
            finally
            {
                camera.targetTexture = previousTarget;
                RenderTexture.active = previousActive;
                if (texture != null)
                {
                    UnityEngine.Object.DestroyImmediate(texture);
                }
                if (rt != null)
                {
                    RenderTexture.ReleaseTemporary(rt);
                }
            }
        }
    }
}
