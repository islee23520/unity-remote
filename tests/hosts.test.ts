import { describe, expect, it } from "vitest";
import {
  advertisedAddresses,
  formatListenBanner,
  isAllowedHostHeader,
  isAllowedOrigin,
  parseAllowedHosts,
  resolveBindHost
} from "../src/server/hosts.js";

describe("host allowlist", () => {
  it("allows loopback, private LAN, and explicit extra hosts", () => {
    expect(isAllowedHostHeader("127.0.0.1:4173")).toBe(true);
    expect(isAllowedHostHeader("localhost:4173")).toBe(true);
    expect(isAllowedHostHeader("[::1]:4173")).toBe(true);
    expect(isAllowedHostHeader("192.168.1.20:4173")).toBe(true);
    expect(isAllowedHostHeader("10.8.0.4:4173")).toBe(true);
    expect(isAllowedHostHeader("100.64.0.1:4173")).toBe(true);
    expect(isAllowedHostHeader("172.16.9.2:4173")).toBe(true);
    expect(isAllowedHostHeader("studio.local:4173", ["studio.local"])).toBe(true);
    expect(isAllowedOrigin("http://192.168.1.20:4173")).toBe(true);
    expect(isAllowedOrigin("http://127.0.0.1:5173")).toBe(true);
    expect(isAllowedOrigin("https://studio.local", ["studio.local"])).toBe(true);
  });

  it("rejects public hosts, public IPs, and unlisted names", () => {
    expect(isAllowedHostHeader("evil.example:4173")).toBe(false);
    expect(isAllowedHostHeader("8.8.8.8:4173")).toBe(false);
    expect(isAllowedHostHeader("172.32.0.1:4173")).toBe(false);
    expect(isAllowedHostHeader("studio.local:4173")).toBe(false);
    expect(isAllowedOrigin("https://evil.example")).toBe(false);
    expect(isAllowedOrigin("file://192.168.1.20")).toBe(false);
  });

  it("parses extra hosts and bind addresses", () => {
    expect(parseAllowedHosts("Studio.local, 10.0.0.9:4173")).toEqual(["studio.local", "10.0.0.9"]);
    expect(resolveBindHost(undefined)).toBe("0.0.0.0");
    expect(resolveBindHost("127.0.0.1")).toBe("127.0.0.1");
    expect(() => resolveBindHost("evil.example")).toThrow(/UNITY_REMOTE_BIND/);
    expect(advertisedAddresses("127.0.0.1")).toEqual(["127.0.0.1"]);
    expect(
      formatListenBanner({
        bindHost: "127.0.0.1",
        port: 4173,
        tokenPath: ".unity-remote-token",
        bootstrapNonce: "abc",
        webBuilt: true
      })
    ).toContain("http://127.0.0.1:4173/api/bootstrap?code=abc");
  });
});
