export const ALLOW_REPO_FALLBACK_ENV_NAME = 'ALLOW_REPO_FALLBACK';
export const ALLOW_REPO_FALLBACK_ENV = `${ALLOW_REPO_FALLBACK_ENV_NAME}=true` as const;

export function isRepoFallbackAllowed(): boolean {
    return process.env[ALLOW_REPO_FALLBACK_ENV_NAME] === 'true';
}

export class RepoFallbackDisabledError extends Error {
    readonly name = 'RepoFallbackDisabledError';

    constructor(cause: unknown) {
        super(
            `Maven dependency resolution failed and repo fallback is disabled. Set ${ALLOW_REPO_FALLBACK_ENV} to allow scanning the local Maven repository.`,
            { cause }
        );
    }
}
