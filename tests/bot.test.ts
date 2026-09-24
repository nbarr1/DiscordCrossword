import nacl from 'tweetnacl';
import { describe, expect, it } from 'vitest';
import { handleDiscordInteractions } from '../packages/server/src/discord/interactions.js';
import { verifyDiscordSignature } from '../packages/server/src/discord/signature.js';

describe('Discord Bot & Interactions', () => {
  it('validates ed25519 request signature accurately', () => {
    // Generate ephemeral keypair
    const keypair = nacl.sign.keyPair();
    const publicKeyHex = Buffer.from(keypair.publicKey).toString('hex');

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
    const isValid = verifyDiscordSignature(body, signatureHex, timestamp, publicKeyHex);
    expect(isValid).toBe(true);

    // Tampered body check
    const isTamperedValid = verifyDiscordSignature(
      JSON.stringify({ type: 2 }),
      signatureHex,
      timestamp,
      publicKeyHex
    );
    expect(isTamperedValid).toBe(false);
  });

  it('responds to Ping interaction (Type 1) with Pong', async () => {
    let responseData: any = null;

    const req: any = {
      header: () => '',
      body: { type: 1 },
    };

    const res: any = {
      status: () => res,
      send: () => res,
      json: (data: any) => {
        responseData = data;
      },
    };

    await handleDiscordInteractions(req, res);
    expect(responseData).toEqual({ type: 1 });
  });

  it('enforces Manage Guild permissions on setup command', async () => {
    let responseData: any = null;

    const req: any = {
      header: () => '',
      body: {
        type: 2,
        guild_id: '111222333',
        member: {
          permissions: '0', // No Manage Guild permission (0x20)
        },
        data: {
          name: 'crossword-setup',
          options: [{ name: 'channel', value: '444555' }],
        },
      },
    };

    const res: any = {
      status: () => res,
      send: () => res,
      json: (data: any) => {
        responseData = data;
      },
    };

    await handleDiscordInteractions(req, res);
    expect(responseData?.type).toBe(4);
    expect(responseData?.data?.content).toContain('Manage Server');
  });
});
