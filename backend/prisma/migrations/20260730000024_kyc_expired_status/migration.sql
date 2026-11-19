-- Add 'expired' to KycStatus enum
ALTER TYPE "KycStatus" ADD VALUE IF NOT EXISTS 'expired';
