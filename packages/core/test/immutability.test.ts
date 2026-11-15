import { describe, expect, it, vi } from 'vitest';
import {
  classifyImmutabilityProbe,
  decideRemoteSetup,
  describeReleaseImmutability
} from '../src/immutability';
import { GitHubClient } from '../src/github';

function response(status: number, body?: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body
  } as unknown as Response;
}

describe('classifyImmutabilityProbe', () => {
  it('treats 200 with enabled=true as enabled', () => {
    const check = classifyImmutabilityProbe({
      type: 'response',
      host: 'github.com',
      status: 200,
      body: { enabled: true, enforced_by_owner: false }
    });
    expect(check).toEqual({ kind: 'enabled', enforcedByOwner: false });
  });

  it('treats 200 with enabled=false as disabled', () => {
    const check = classifyImmutabilityProbe({
      type: 'response',
      host: 'github.com',
      status: 200,
      body: { enabled: false }
    });
    expect(check).toEqual({ kind: 'disabled', source: 'api' });
  });

  it('treats 404 on github.com as disabled', () => {
    const check = classifyImmutabilityProbe({
      type: 'response',
      host: 'github.com',
      status: 404
    });
    expect(check).toEqual({ kind: 'disabled', source: 'not-found' });
  });

  it('treats 403 as unknown because admin read is required', () => {
    const check = classifyImmutabilityProbe({
      type: 'response',
      host: 'github.com',
      status: 403
    });
    expect(check).toEqual({ kind: 'unknown', reason: 'forbidden' });
  });

  it('treats network failures as unknown', () => {
    const check = classifyImmutabilityProbe({ type: 'network-error', message: 'timeout' });
    expect(check).toEqual({ kind: 'unknown', reason: 'network' });
  });

  it('treats non-github.com hosts as unknown', () => {
    const check = classifyImmutabilityProbe({
      type: 'response',
      host: 'github.example.com',
      status: 200,
      body: { enabled: true }
    });
    expect(check).toEqual({ kind: 'unknown', reason: 'non-github-host' });
  });
});

describe('GitHubClient.getImmutableReleasesStatus', () => {
  it('reports enabled from the dedicated endpoint', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(response(200, { enabled: true, enforced_by_owner: true }));
    const client = new GitHubClient(async () => 'token', fetchMock as unknown as typeof fetch);

    const check = await client.getImmutableReleasesStatus('owner', 'repo');

    expect(check).toEqual({ kind: 'enabled', enforcedByOwner: true });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/owner/repo/immutable-releases',
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('reports disabled from enabled=false', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(200, { enabled: false }));
    const client = new GitHubClient(async () => 'token', fetchMock as unknown as typeof fetch);

    const check = await client.getImmutableReleasesStatus('owner', 'repo');

    expect(check).toEqual({ kind: 'disabled', source: 'api' });
  });

  it('reports disabled from 404 on github.com', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(404));
    const client = new GitHubClient(async () => 'token', fetchMock as unknown as typeof fetch);

    const check = await client.getImmutableReleasesStatus('owner', 'repo');

    expect(check).toEqual({ kind: 'disabled', source: 'not-found' });
  });

  it('reports unknown from 403', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(403));
    const client = new GitHubClient(async () => 'token', fetchMock as unknown as typeof fetch);

    const check = await client.getImmutableReleasesStatus('owner', 'repo');

    expect(check).toEqual({ kind: 'unknown', reason: 'forbidden' });
  });

  it('reports unknown instead of throwing on network errors', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'));
    const client = new GitHubClient(async () => 'token', fetchMock as unknown as typeof fetch);

    const check = await client.getImmutableReleasesStatus('owner', 'repo');

    expect(check).toEqual({ kind: 'unknown', reason: 'network' });
  });
});

describe('decideRemoteSetup', () => {
  const settingsUrl = 'https://github.com/owner/repo/settings';

  it('allows saving when the API confirms the setting', () => {
    const decision = decideRemoteSetup({ kind: 'enabled', enforcedByOwner: false }, false, settingsUrl);
    expect(decision.ok).toBe(true);
    expect(decision.message).toContain('Release immutability is enabled');
  });

  it('blocks saving when the API reports disabled', () => {
    const decision = decideRemoteSetup({ kind: 'disabled', source: 'api' }, true, settingsUrl);
    expect(decision.ok).toBe(false);
    expect(decision.message).toContain(settingsUrl);
  });

  it('does not block unknown status when the user confirms manually', () => {
    const decision = decideRemoteSetup(
      { kind: 'unknown', reason: 'forbidden' },
      true,
      settingsUrl
    );
    expect(decision.ok).toBe(true);
    expect(decision.message).toContain('Cannot confirm release immutability');
  });

  it('asks for manual confirmation when status is unknown', () => {
    const decision = decideRemoteSetup(
      { kind: 'unknown', reason: 'network' },
      false,
      settingsUrl
    );
    expect(decision.ok).toBe(false);
    expect(decision.message).toContain('I have confirmed that Enable release immutability');
  });
});

describe('describeReleaseImmutability', () => {
  it('confirms immutable releases', () => {
    expect(describeReleaseImmutability(true)).toContain('confirmed immutable');
  });

  it('warns about mutable releases', () => {
    expect(describeReleaseImmutability(false)).toContain('release is mutable');
  });

  it('reports unknown when the field is missing', () => {
    expect(describeReleaseImmutability(undefined)).toContain('unknown');
  });
});
