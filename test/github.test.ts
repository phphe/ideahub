import { describe, expect, it, vi } from 'vitest';
import { GitHubApiError, GitHubClient } from '../src/core/github';

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
