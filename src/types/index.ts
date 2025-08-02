
export type Repository = {
  id: string; // Should be in the format "owner/repo"
  url: string;
  lastSeenReleaseTag?: string;
  isNew?: boolean;
  // New: Per-repository settings override
  // Empty arrays/undefined mean "use global setting"
  releaseChannels?: ReleaseChannel[];
  preReleaseSubChannels?: PreReleaseChannelType[];
  releasesPerPage?: number | null;
  includeRegex?: string;
  excludeRegex?: string;
  appriseTags?: string;
};

export type GithubRelease = {
  id: number;
  html_url: string;
  tag_name: string;
  name: string | null;
  body: string | null;
  created_at: string;
  published_at: string | null;
  prerelease: boolean;
  draft: boolean;
  fetched_at?: string; // Timestamp for when the data was fetched
};

export type FetchError = {
  type: 'rate_limit' | 'repo_not_found' | 'no_releases_found' | 'no_matching_releases' | 'invalid_url' | 'api_error';
}

export type EnrichedRelease = {
  repoId: string;
  repoUrl: string;
  release?: GithubRelease;
  error?: FetchError;
  isNew?: boolean;
  repoSettings?: {
    releaseChannels?: ReleaseChannel[];
    preReleaseSubChannels?: PreReleaseChannelType[];
    releasesPerPage?: number | null;
    includeRegex?: string;
    excludeRegex?: string;
    appriseTags?: string;
  }
};

// Types for the test page
interface RateLimitInfo {
  limit: number;
  remaining: number;
  reset: number; // Unix epoch seconds
  used: number;
}

export interface GitHubRateLimit {
  resources: {
    core: RateLimitInfo;
    search: RateLimitInfo;
    graphql: RateLimitInfo;
  };
  rate: RateLimitInfo;
}

export type RateLimitResult = {
  data: GitHubRateLimit | null;
  error?: 'invalid_token' | 'api_error';
};

export type NotificationConfig = {
  isSmtpConfigured: boolean;
  isAppriseConfigured: boolean;
  variables: {
    [key: string]: string | null;
  };
};

export type AppriseStatus = {
  status: 'ok' | 'error' | 'not_configured';
  error?: string;
};


// App Settings
export type Locale = 'en' | 'de';
export type TimeFormat = '12h' | '24h';
export type ReleaseChannel = 'stable' | 'prerelease' | 'draft';
export type PreReleaseChannelType = 'a' | 'alpha' | 'b' | 'beta' | 'canary' | 'cr' | 'dev' | 'eap' | 'm' | 'milestone' | 'next' | 'nightly' | 'pre' | 'preview' | 'pr' | 'rc' | 'snapshot' | 'sp' | 'tp';
export const allPreReleaseTypes: PreReleaseChannelType[] = ['a', 'alpha', 'b', 'beta', 'canary', 'cr', 'dev', 'eap', 'm', 'milestone', 'next', 'nightly', 'pre', 'preview', 'pr', 'rc', 'snapshot', 'sp', 'tp'];


export type AppSettings = {
  timeFormat: TimeFormat;
  locale: Locale;
  // The total refresh interval, stored in minutes.
  refreshInterval: number;
  // The total cache interval, stored in minutes.
  cacheInterval: number;
  releasesPerPage: number;
  releaseChannels: ReleaseChannel[];
  preReleaseSubChannels?: PreReleaseChannelType[];
  showAcknowledge?: boolean;
  showMarkAsNew?: boolean;
  includeRegex?: string;
  excludeRegex?: string;
  appriseMaxCharacters?: number;
  appriseTags?: string;
};

// Session Data
export type SessionData = {
    isLoggedIn?: boolean;
    username?: string;
};
