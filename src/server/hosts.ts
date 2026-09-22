import { isIP, BlockList } from "node:net";
import { hostname as osHostname, networkInterfaces } from "node:os";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

const TRUSTED_NETS = new BlockList();
TRUSTED_NETS.addSubnet("10.0.0.0", 8, "ipv4");
TRUSTED_NETS.addSubnet("100.64.0.0", 10, "ipv4");
TRUSTED_NETS.addSubnet("127.0.0.0", 8, "ipv4");
TRUSTED_NETS.addSubnet("169.254.0.0", 16, "ipv4");
TRUSTED_NETS.addSubnet("172.16.0.0", 12, "ipv4");
TRUSTED_NETS.addSubnet("192.168.0.0", 16, "ipv4");
TRUSTED_NETS.addAddress("::1", "ipv6");
TRUSTED_NETS.addSubnet("fc00::", 7, "ipv6");
TRUSTED_NETS.addSubnet("fe80::", 10, "ipv6");

export function parseAllowedHosts(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }
  const hosts: string[] = [];
  for (const part of raw.split(",")) {
    const hostname = normalizeHostname(part);
    if (hostname) {
      hosts.push(hostname);
    }
  }
  return hosts;
}

export function normalizeHostname(value: string): string | undefined {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.includes("://")) {
    try {
      return new URL(trimmed).hostname.toLowerCase();
    } catch {
      return undefined;
    }
  }
  return hostnameFromHostHeader(trimmed);
}

export function hostnameFromHostHeader(hostHeader: string | undefined): string | undefined {
  if (!hostHeader) {
    return undefined;
  }
  const trimmed = hostHeader.trim().toLowerCase();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.startsWith("[")) {
    const end = trimmed.indexOf("]");
    if (end === -1) {
      return undefined;
    }
    return trimmed.slice(1, end);
  }
  return trimmed.split(":")[0];
}

export function isTrustedIp(address: string): boolean {
  const mapped = mappedIPv4(address);
  if (mapped) {
    return TRUSTED_NETS.check(mapped, "ipv4");
  }
  const version = isIP(address);
  if (version === 4) {
    return TRUSTED_NETS.check(address, "ipv4");
  }
  if (version === 6) {
    return TRUSTED_NETS.check(address, "ipv6");
  }
  return false;
}

export function isAllowedHostname(hostname: string | undefined, extraHosts: readonly string[] = []): boolean {
  if (!hostname) {
    return false;
  }
  const normalized = hostname.toLowerCase();
  if (LOOPBACK_HOSTS.has(normalized) || isTrustedIp(normalized)) {
    return true;
  }
  return extraHosts.some((host) => host.toLowerCase() === normalized);
}

export function isAllowedHostHeader(hostHeader: string | undefined, extraHosts: readonly string[] = []): boolean {
  return isAllowedHostname(hostnameFromHostHeader(hostHeader), extraHosts);
}

export function isAllowedOrigin(origin: string, extraHosts: readonly string[] = []): boolean {
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }
    return isAllowedHostname(parsed.hostname.toLowerCase(), extraHosts);
  } catch {
    return false;
  }
}

export function localInterfaceAddresses(): string[] {
  const addresses: string[] = [];
  for (const nics of Object.values(networkInterfaces())) {
    for (const nic of nics ?? []) {
      if (nic.internal) {
        continue;
      }
      if (nic.family === "IPv4") {
        addresses.push(nic.address);
      }
    }
  }
  return addresses;
}

export function localHostnames(): string[] {
  const name = osHostname().trim().toLowerCase();
  if (!name) {
    return [];
  }
  const hosts = new Set<string>([name]);
  const short = name.split(".")[0];
  if (short) {
    hosts.add(short);
    hosts.add(`${short}.local`);
  }
  return [...hosts];
}

export function defaultExtraHosts(env: NodeJS.ProcessEnv = process.env): string[] {
  return [...parseAllowedHosts(env.UNITY_REMOTE_ALLOWED_HOSTS), ...localHostnames(), ...localInterfaceAddresses()];
}

export function resolveBindHost(raw: string | undefined): string {
  const value = raw?.trim() || "0.0.0.0";
  if (value === "0.0.0.0" || value === "::" || value === "localhost" || isIP(value) === 4 || isIP(value) === 6) {
    return value;
  }
  throw new Error(`UNITY_REMOTE_BIND must be an IP address, received ${value}`);
}

export function advertisedAddresses(bindHost: string): string[] {
  if (bindHost === "127.0.0.1" || bindHost === "::1" || bindHost === "localhost") {
    return ["127.0.0.1"];
  }
  return ["127.0.0.1", ...localInterfaceAddresses()];
}

export function formatListenBanner(input: {
  bindHost: string;
  port: number;
  tokenPath: string;
  bootstrapNonce: string;
  webBuilt: boolean;
}): string {
  const addresses = advertisedAddresses(input.bindHost);
  const lines = ["Unity Remote listening on:"];
  for (const address of addresses) {
    lines.push(`  http://${formatHost(address)}:${input.port}`);
  }
  lines.push(`Session token written to ${input.tokenPath}`);
  lines.push("One-time browser bootstrap:");
  for (const address of addresses) {
    lines.push(`  http://${formatHost(address)}:${input.port}/api/bootstrap?code=${input.bootstrapNonce}`);
  }
  if (!input.webBuilt) {
    lines.push("Web client is not built yet. Run `npm run build` or `npx vite --host 0.0.0.0 --port 5173`.");
  }
  return lines.join("\n");
}

function formatHost(address: string): string {
  return isIP(address) === 6 ? `[${address}]` : address;
}

function mappedIPv4(address: string): string | undefined {
  const lower = address.toLowerCase();
  if (!lower.startsWith("::ffff:")) {
    return undefined;
  }
  const rest = address.slice(7);
  return isIP(rest) === 4 ? rest : undefined;
}
