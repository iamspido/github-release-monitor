import type { PreReleaseChannelType, ReleaseChannel } from "@/types";
import { allPreReleaseTypes } from "@/types";

export function toggleReleaseChannel(
  channels: ReleaseChannel[],
  channel: ReleaseChannel,
): ReleaseChannel[] {
  return channels.includes(channel)
    ? channels.filter((current) => current !== channel)
    : [...channels, channel];
}

export function togglePreReleaseSubChannel(
  channels: PreReleaseChannelType[],
  channel: PreReleaseChannelType,
): PreReleaseChannelType[] {
  return channels.includes(channel)
    ? channels.filter((current) => current !== channel)
    : [...channels, channel];
}

export function shouldSelectAllPreReleaseSubChannels(
  channel: ReleaseChannel,
  channels: ReleaseChannel[],
): boolean {
  return channel === "prerelease" && channels.includes("prerelease");
}

export function getAllPreReleaseSubChannels(): PreReleaseChannelType[] {
  return allPreReleaseTypes;
}
