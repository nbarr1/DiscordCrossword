import nacl from 'tweetnacl';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handleDiscordInteractions } from '../packages/server/src/discord/interactions.js';
import { verifyDiscordSignature } from '../packages/server/src/discord/signature.js';

const keypair = nacl.sign.keyPair();
const PUBLIC_KEY_HEX = Buffer.from(keypair.publicKey).toString('hex');

/**
 * Builds a request shaped like the one express.raw() produces: a raw Buffer body
 * plus Discord's signature headers.
 */
function signedRequest(payload: object, secretKey: Uint8Array = keypair.secretKey) {
  const body = Buffer.from(JSON.stringify(payload), 'utf-8');
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = Buffer.from(
    nacl.sign.detached(Buffer.concat([Buffer.from(timestamp, 'utf-8'), body]), secretKey)
  ).toString('hex');
  const headers: Record<string, string> = {
    'x-signature-ed25519': signature,
    'x-signature-timestamp': timestamp,
  };
  return { header: (name: string) => headers[name.toLowerCase()], body } as any;
}

function mockResponse() {
  const res: any = { statusCode: 200, body: undefined };
  res.status = (code: number) => {
    res.statusCode = code;
    return res;
  };
  res.send = (body: any) => {
    res.body = body;
    return res;
  };
  res.json = (body: any) => {
    res.body = body;
    return res;
  };
  return res;
}

describe('Discord Bot & Interactions', () => {
  let savedPublicKey: string | undefined;

  beforeEach(() => {
    savedPublicKey = process.env.DISCORD_PUBLIC_KEY;
    process.env.DISCORD_PUBLIC_KEY = PUBLIC_KEY_HEX;
  });

  afterEach(() => {
    if (savedPublicKey === undefined) delete process.env.DISCORD_PUBLIC_KEY;
    else process.env.DISCORD_PUBLIC_KEY = savedPublicKey;
  });

  it('validates ed25519 request signature accurately', () => {
    const timestamp = '1600000000';
    const body = JSON.stringify({ type: 1 });

    // Sign message
    const message = Buffer.concat([
      Buffer.from(timestamp, 'utf-8'),
      Buffer.from(body, 'utf-8'),
    ]);
    const signature = nacl.sign.detached(message, keypair.secretKey);
    const signatureHex = Buffer.from(signature).toString('hex');

    // Positive check
    const isValid = verifyDiscordSignature(body, signatureHex, timestamp, PUBLIC_KEY_HEX);
    expect(isValid).toBe(true);

    // Tampered body check
    const isTamperedValid = verifyDiscordSignature(
      JSON.stringify({ type: 2 }),
      signatureHex,
      timestamp,
      PUBLIC_KEY_HEX
    );
    expect(isTamperedValid).toBe(false);
  });

  it('responds to Ping interaction (Type 1) with Pong', async () => {
    const res = mockResponse();
    await handleDiscordInteractions(signedRequest({ type: 1 }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ type: 1 });
  });

  it('rejects requests signed with a different key', async () => {
    const res = mockResponse();
    const otherKey = nacl.sign.keyPair().secretKey;
    await handleDiscordInteractions(signedRequest({ type: 1 }, otherKey), res);
    expect(res.statusCode).toBe(401);
  });

  it('rejects every interaction when DISCORD_PUBLIC_KEY is not configured', async () => {
    delete process.env.DISCORD_PUBLIC_KEY;
    const res = mockResponse();
    const forged = {
      header: () => undefined,
      body: Buffer.from(JSON.stringify({ type: 2, guild_id: '1', member: { permissions: '8' }, data: { name: 'crossword-setup' } })),
    } as any;
    await handleDiscordInteractions(forged, res);
    expect(res.statusCode).toBe(401);
  });

  it('parses the raw Buffer body and enforces Manage Guild permissions on setup command', async () => {
    const res = mockResponse();
    await handleDiscordInteractions(
      signedRequest({
        type: 2,
        guild_id: '111222333',
        member: {
          permissions: '0', // No Manage Guild permission (0x20)
        },
        data: {
          name: 'crossword-setup',
          options: [{ name: 'channel', value: '444555' }],
        },
      }),
      res
    );
    expect(res.body?.type).toBe(4);
    expect(res.body?.data?.content).toContain('Manage Server');
  });

  it('answers the Entry Point command with LAUNCH_ACTIVITY', async () => {
    const res = mockResponse();
    await handleDiscordInteractions(
      signedRequest({ type: 2, data: { name: 'crossword', type: 4 } }),
      res
    );
    expect(res.body).toEqual({ type: 12 });
  });
});
