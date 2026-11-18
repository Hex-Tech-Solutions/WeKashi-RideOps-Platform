import { describe, it, expect } from 'vitest';
import { profileMissing, type ProfileFields } from '../src/lib/driverProfile';

const complete: ProfileFields = {
  dlNumber: 'KA0520231234567',
  dlExpiry: new Date('2030-01-01'),
  govIdNumber: 'XXXX XXXX 1234',
  govIdHash: 'abc',
  upiVpa: 'driver@okaxis',
  vehicleType: 'sedan',
  seats: 5,
  vehicle: { regNo: 'KA05AB1234', capacity: 5, fuelType: 'petrol' },
};

describe('profileMissing (#9)', () => {
  it('is empty when every required detail is filled in', () => {
    expect(profileMissing(complete)).toEqual([]);
  });

  it('lists everything for a fresh sign-up with only a vehicle number', () => {
    expect(profileMissing({
      dlNumber: null, dlExpiry: null, govIdNumber: null, govIdHash: null, upiVpa: null,
      vehicleType: null, seats: null,
      vehicle: { regNo: 'KA05AB1234', capacity: null, fuelType: null },
    })).toEqual(['dlNumber', 'dlExpiry', 'aadhaar', 'upiId', 'vehicleType', 'seats', 'fuelType']);
  });

  it('treats a released (removed/rejected) vehicle number as missing', () => {
    expect(profileMissing({ ...complete, vehicle: { ...complete.vehicle!, regNo: 'removed:1a2b3c4d:KA05AB1234' } }))
      .toEqual(['vehicleNo']);
    expect(profileMissing({ ...complete, vehicle: null })).toEqual(['vehicleNo', 'fuelType']);
  });

  it('accepts a legacy 12-digit Aadhaar without a hash', () => {
    expect(profileMissing({ ...complete, govIdHash: null, govIdNumber: '1234 5678 9012' })).toEqual([]);
    expect(profileMissing({ ...complete, govIdHash: null, govIdNumber: 'XXXX XXXX 9012' })).toEqual(['aadhaar']);
  });

  it('requires a UPI ID (blank counts as missing)', () => {
    expect(profileMissing({ ...complete, upiVpa: null })).toEqual(['upiId']);
    expect(profileMissing({ ...complete, upiVpa: '   ' })).toEqual(['upiId']);
  });

  it('takes seats from the vehicle row when the driver field is empty', () => {
    expect(profileMissing({ ...complete, seats: null })).toEqual([]);
  });
});
