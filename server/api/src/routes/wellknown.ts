import type { FastifyInstance } from 'fastify';
import type { Deps } from '../app.ts';

// Android App Links: lets https://<api-host>/invite/<token> open the app directly.
// The certificate fingerprint is public (it is in every signed APK), but it comes from the environment
// so a new signing key never needs a code change.
export async function wellKnownRoutes(app: FastifyInstance, { cfg }: Deps) {
  app.get('/.well-known/assetlinks.json', async (_req, reply) => {
    reply.header('cache-control', 'public, max-age=3600');
    if (!cfg.android.certSha256.length) return [];
    return [{
      relation: ['delegate_permission/common.handle_all_urls'],
      target: { namespace: 'android_app', package_name: cfg.android.packageName, sha256_cert_fingerprints: cfg.android.certSha256 },
    }];
  });
}
