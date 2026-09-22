using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Newtonsoft.Json.Serialization;

namespace Islee.UnityRemote.Editor
{
    public static class ProtocolJson
    {
        public static readonly JsonSerializerSettings Settings = new JsonSerializerSettings
        {
            NullValueHandling = NullValueHandling.Ignore,
            MissingMemberHandling = MissingMemberHandling.Ignore,
            MaxDepth = 256,
            ContractResolver = new DefaultContractResolver()
        };

        public static string ToJson(object value)
        {
            return JsonConvert.SerializeObject(value, Formatting.Indented, Settings);
        }

        public static T FromJson<T>(string json)
        {
            return JsonConvert.DeserializeObject<T>(json, Settings);
        }

        public static bool JsonEquals(string left, string right)
        {
            return JToken.DeepEquals(JToken.Parse(left), JToken.Parse(right));
        }
    }
}
