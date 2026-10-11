// Creates the first admin and prints an invite link where the admin chooses their password.
//   docker compose run --rm migrate node src/scripts/create-admin.ts <email> "<navn>"
// Runs as powerkrop_owner through admin_bootstrap(), which the API role cannot call.
import { loadOwnerConfig } from '../config.ts';
import { ownerConnection } from '../db.ts';
import { daysFromNow, INVITE_TTL_DAYS, newOpaqueToken, sha256 } from '../auth/tokens.ts';

const [email, name] = process.argv.slice(2);
if (!email || !name) {
  console.error('Brug: node src/scripts/create-admin.ts <email> "<navn>"');
  process.exit(1);
}

const cfg = loadOwnerConfig();
const client = ownerConnection(cfg);
await client.connect();
try {
  const token = newOpaqueToken();
  const r = await client.query<{ id: string }>('select admin_bootstrap($1, $2, $3, $4) as id',
    [email.trim(), name.trim(), sha256(token), daysFromNow(INVITE_TTL_DAYS)]);
  console.log(`Admin oprettet (id ${r.rows[0]!.id}).`);
  console.log(`Åbn linket inden ${INVITE_TTL_DAYS} dage, og vælg et password:\n${cfg.inviteBaseUrl}${token}`);
} catch (e) {
  console.error(`Kunne ikke oprette admin: ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
