using System;
using UnityEditor;
using UnityEngine;

namespace Islee.UnityRemote.Editor
{
    public static class UnityRemoteInput
    {
        public static Action<GameInput> Inject = InjectDefault;

        public static InputResult Send(GameInput input)
        {
            if (input == null || string.IsNullOrEmpty(input.type))
            {
                throw new UnityRemoteException("INVALID_REQUEST", "sendGameInput requires a type.", 400);
            }

            Inject(input);
            return new InputResult { accepted = true };
        }

        public static void ResetSeam()
        {
            Inject = InjectDefault;
        }

        private static void InjectDefault(GameInput input)
        {
            if (!EditorApplication.isPlaying)
            {
                throw new UnityRemoteException("UNITY_ERROR", "Input requires Play Mode.", 422);
            }

            var gameViewType = typeof(EditorWindow).Assembly.GetType("UnityEditor.GameView");
            if (gameViewType == null)
            {
                throw new UnityRemoteException("UNITY_ERROR", "Game View window is unavailable.", 502);
            }

            var window = EditorWindow.GetWindow(gameViewType, false, null, false);
            window.SendEvent(BuildEvent(input, window.position.size));
        }

        private static Event BuildEvent(GameInput input, Vector2 size)
        {
            var evt = new Event();
            var x = (float)(input.x ?? 0d) * Mathf.Max(1f, size.x);
            var y = (float)(input.y ?? 0d) * Mathf.Max(1f, size.y);
            switch (input.type)
            {
                case "keyDown":
                    evt.type = EventType.KeyDown;
                    evt.keyCode = MapKey(input.key);
                    evt.character = CharacterOf(input.key);
                    break;
                case "keyUp":
                    evt.type = EventType.KeyUp;
                    evt.keyCode = MapKey(input.key);
                    break;
                case "mouseMove":
                    evt.type = EventType.MouseMove;
                    evt.mousePosition = new Vector2(x, y);
                    break;
                case "mouseDown":
                    evt.type = EventType.MouseDown;
                    evt.button = input.button ?? 0;
                    evt.mousePosition = new Vector2(x, y);
                    break;
                case "mouseUp":
                    evt.type = EventType.MouseUp;
                    evt.button = input.button ?? 0;
                    evt.mousePosition = new Vector2(x, y);
                    break;
                default:
                    throw new UnityRemoteException("INVALID_REQUEST", $"Unknown input type '{input.type}'.", 400);
            }

            return evt;
        }

        private static KeyCode MapKey(string key)
        {
            if (string.IsNullOrEmpty(key))
            {
                return KeyCode.None;
            }

            if (key.Length == 1)
            {
                var letter = key.ToUpperInvariant()[0];
                if (letter >= 'A' && letter <= 'Z' && Enum.TryParse(letter.ToString(), out KeyCode letterCode))
                {
                    return letterCode;
                }
                if (letter >= '0' && letter <= '9' && Enum.TryParse("Alpha" + letter, out KeyCode digitCode))
                {
                    return digitCode;
                }
            }

            return key switch
            {
                "ArrowUp" => KeyCode.UpArrow,
                "ArrowDown" => KeyCode.DownArrow,
                "ArrowLeft" => KeyCode.LeftArrow,
                "ArrowRight" => KeyCode.RightArrow,
                " " or "Space" or "Spacebar" => KeyCode.Space,
                "Enter" => KeyCode.Return,
                "Escape" => KeyCode.Escape,
                "Tab" => KeyCode.Tab,
                "Shift" => KeyCode.LeftShift,
                "Control" => KeyCode.LeftControl,
                "Alt" => KeyCode.LeftAlt,
                "Meta" => KeyCode.LeftMeta,
                "Backspace" => KeyCode.Backspace,
                _ => Enum.TryParse(key, true, out KeyCode parsed) ? parsed : KeyCode.None
            };
        }

        private static char CharacterOf(string key)
        {
            return !string.IsNullOrEmpty(key) && key.Length == 1 ? key[0] : '\0';
        }
    }
}
