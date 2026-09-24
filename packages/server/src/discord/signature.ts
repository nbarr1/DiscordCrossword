import nacl from 'tweetnacl';

/**
 * Verifies the Discord HTTP Interaction ed25519 signature.
 */
export function verifyDiscordSignature(
  rawBody: string | Buffer,
  signature: string | undefined,
  timestamp: string | undefined,
  clientPublicKey: string
): boolean {
  if (!signature || !timestamp || !clientPublicKey) {
    return false;
  }

  try {
    const message = Buffer.concat([
      Buffer.from(timestamp, 'utf-8'),
      Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf-8'),
    ]);

    return nacl.sign.detached.verify(
      message,
      Buffer.from(signature, 'hex'),
      Buffer.from(clientPublicKey, 'hex')
    );
  } catch (err) {
    console.error('[DiscordSignature] Verification failed with error:', err);
    return false;
  }
}
