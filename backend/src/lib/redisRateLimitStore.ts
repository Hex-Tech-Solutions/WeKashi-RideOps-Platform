import type { Store, Options, IncrementResponse } from 'express-rate-limit';
import { redis } from './redis';

/**
 * express-rate-limit store backed by Redis, so every API process shares one
 * count per key. With the default in-memory store, running 3 API processes
 * would give each user (and each OTP phone number) 3x the intended budget.
 *
 * One atomic Lua call per request: INCR, set the window expiry on the first
 * hit, and return the count with the time left.
 */
const INCREMENT = `
local c = redis.call('INCR', KEYS[1])
if c == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local t = redis.call('PTTL', KEYS[1])
if t < 0 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) t = tonumber(ARGV[1]) end
return { c, t }
`;

export class RedisRateLimitStore implements Store {
  windowMs = 60_000;
  readonly localKeys = false;

  /** `prefix` must be unique per limiter (e.g. 'rl:global:'). */
  constructor(readonly prefix: string) {}

  init(options: Options): void {
    this.windowMs = options.windowMs;
  }

  async increment(key: string): Promise<IncrementResponse> {
    const [count, ttl] = (await redis.eval(INCREMENT, 1, this.prefix + key, String(this.windowMs))) as [number, number];
    return { totalHits: Number(count), resetTime: new Date(Date.now() + Number(ttl)) };
  }

  async decrement(key: string): Promise<void> {
    await redis.decr(this.prefix + key);
  }

  async resetKey(key: string): Promise<void> {
    await redis.del(this.prefix + key);
  }
}