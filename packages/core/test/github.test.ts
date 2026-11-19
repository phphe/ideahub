import { describe, expect, it, vi } from 'vitest';
import { GitHubApiError, GitHubClient } from '../src/github';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

describe('GitHubClient.createRelease', () => {
  it('parses the 422 errors payload and surfaces the original errors', async () => {
    const errors = [
      {
        resource: 'Release',
        field: 'target_commitish',
        code: 'invalid',
        message: 'target_commitish is invalid'
      }
    ];
    const fetchMock = vi.fn(async (_input: string, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'POST') {
        return jsonResponse(422, {
          message: 'Validation Failed',
          errors,
          documentation_url:
            'https://docs.github.com/rest/releases/releases#create-a-release'
        });
      }
      return new Response('{}', { status: 404 });
    });
    const client = new GitHubClient(
      async () => 'secret-token',
      fetchMock as unknown as typeof fetch
    );

    let caught: unknown;
    try {
      await client.createRelease('owner', 'repo', 'ideahub-abc123', 'hash', 'main');
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(GitHubApiError);
    if (!(caught instanceof GitHubApiError)) {
      throw new Error('expected a GitHubApiError');
    }
    expect(caught.status).toBe(422);
    expect(caught.url).toBe('https://api.github.com/repos/owner/repo/releases');
    expect(caught.payload?.message).toBe('Validation Failed');
    expect(caught.payload?.errors).toEqual(errors);
    expect(caught.message).toContain('HTTP 422');
    expect(caught.message).toContain('target_commitish');
    expect(caught.message).toContain(JSON.stringify(errors));
    expect(caught.message).not.toContain('secret-token');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('sends the validated tag and remote commit SHA on the happy path', async () => {
    let sentBody: Record<string, unknown> | null = null;
    const fetchMock = vi.fn(async (_input: string, init?: RequestInit) => {
      sentBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      return jsonResponse(201, {
        tag_name: 'ideahub-abc123',
        published_at: '2026-11-05T00:00:00Z',
        immutable: false
      });
    });
    const client = new GitHubClient(
      async () => 'token',
      fetchMock as unknown as typeof fetch
    );

    const result = await client.createRelease(
      'owner',
      'repo',
      'ideahub-abc123',
      'hash',
      'abc123def456'
    );

    expect(result.created).toBe(true);
    expect(sentBody).toMatchObject({
      tag_name: 'ideahub-abc123',
      target_commitish: 'abc123def456'
    });
    const sent = sentBody as Record<string, unknown> | null;
    expect(String(sent?.['body'])).not.toContain('sha256=');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not treat 422 as an existing release when the tag has no release', async () => {
    const fetchMock = vi.fn(async (_input: string, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'POST') {
        return jsonResponse(422, {
          message: 'Validation Failed',
          errors: [
            {
              resource: 'Release',
              field: 'tag_name',
              code: 'already_exists',
              message: 'tag_name already exists'
            }
          ]
        });
      }
      return new Response('{"message":"Not Found"}', { status: 404 });
    });
    const client = new GitHubClient(
      async () => 'token',
      fetchMock as unknown as typeof fetch
    );

    await expect(
      client.createRelease('owner', 'repo', 'ideahub-abc123', 'hash', 'main')
    ).rejects.toThrow(/already_exists/);
  });
});

describe('GitHubClient.getCommit', () => {
  it('returns the commit SHA when the remote has it', async () => {
    const urls: string[] = [];
    const fetchMock = vi.fn(async (input: string) => {
      urls.push(String(input));
      return jsonResponse(200, { sha: 'abcdef1234567890abcdef1234567890abcdef12' });
    });
    const client = new GitHubClient(
      async () => 'token',
      fetchMock as unknown as typeof fetch
    );

    const result = await client.getCommit(
      'owner',
      'repo',
      'abcdef1234567890abcdef1234567890abcdef12'
    );

    expect(result).toEqual({ sha: 'abcdef1234567890abcdef1234567890abcdef12' });
    expect(urls[0]).toBe(
      'https://api.github.com/repos/owner/repo/commits/abcdef1234567890abcdef1234567890abcdef12'
    );
  });

  it('returns null when the commit is unknown so the caller can fall back', async () => {
    const fetchMock = vi.fn(async () => new Response('{"message":"Not Found"}', { status: 404 }));
    const client = new GitHubClient(
      async () => 'token',
      fetchMock as unknown as typeof fetch
    );

    await expect(client.getCommit('owner', 'repo', 'deadbeef')).resolves.toBeNull();
  });
});

describe('GitHubClient.listAllReleases', () => {
  it('pages through the release list until a short page arrives', async () => {
    const firstPage = Array.from({ length: 100 }, (_value, index) => ({
      tag_name: `ideahub-${index}`,
      published_at: '2026-11-01T00:00:00Z',
      immutable: true
    }));
    const secondPage = [
      { tag_name: 'ideahub-last', published_at: '2026-11-02T00:00:00Z', immutable: true }
    ];
    const urls: string[] = [];
    const fetchMock = vi.fn(async (input: string) => {
      urls.push(String(input));
      return jsonResponse(200, urls.length === 1 ? firstPage : secondPage);
    });
    const client = new GitHubClient(
      async () => 'token',
      fetchMock as unknown as typeof fetch
    );

    const releases = await client.listAllReleases('owner', 'repo');

    expect(releases).toHaveLength(101);
    expect(releases[100].tagName).toBe('ideahub-last');
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain('per_page=100&page=1');
    expect(urls[1]).toContain('per_page=100&page=2');
  });
});
