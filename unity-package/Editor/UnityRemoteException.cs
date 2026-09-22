using System;
using System.Collections.Generic;

namespace Islee.UnityRemote.Editor
{
    public sealed class UnityRemoteException : Exception
    {
        public UnityRemoteException(string code, string message, int statusCode, Dictionary<string, object> details = null)
            : base(message)
        {
            this.code = code;
            this.statusCode = statusCode;
            this.details = details ?? new Dictionary<string, object>();
        }

        public string code { get; }
        public int statusCode { get; }
        public Dictionary<string, object> details { get; }

        public ErrorBody ToErrorBody()
        {
            return new ErrorBody
            {
                code = code,
                message = Message,
                details = details,
                statusCode = statusCode
            };
        }
    }
}
