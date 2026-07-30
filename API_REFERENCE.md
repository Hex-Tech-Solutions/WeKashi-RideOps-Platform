# RideOps — Complete API Reference

**Base URL (production):** `https://yourdomain.com/api`  
**Base URL (local dev):** `http://localhost:3000/api` (proxied from Vite at `http://localhost:8080/api`)

All endpoints require a Bearer token in the `Authorization` header unless marked **[Public]**.  
Token format: `Authorization: Bearer <accessToken>`

---

## Authentication

### POST /auth/login
Sign in as admin, supervisor, or vendor.

**Auth:** Public  
**Body:**
```json
{ "email": "user@example.com", "password": "password" }
```
**Response:**
```json
{
  "accessToken": "eyJ...",
  "refreshToken": "eyJ...",
  "user": { "id": "uuid", "role": "supervisor", "fullName": "Jane Doe" }
}
```

---

### POST /auth/register
Register a new admin/supervisor/vendor account (requires invite token for admin role).

**Auth:** Public  
**Headers:** `x-invite-token: <token>` (admin only)  
**Body:**
```json
{ "email": "...", "password": "...", "role": "supervisor", "fullName": "...", "org": "..." }
```

---

### POST /auth/refresh
Rotate access token using a valid refresh token.

**Auth:** Public (sends refresh token in body)  
**Rate limit:** 30 req / 15 min  
**Body:** `{ "refreshToken": "eyJ..." }`  
**Response:** `{ "accessToken": "...", "refreshToken": "..." }`

---

### POST /auth/logout
Revoke the refresh token.

**Auth:** Required  
**Body:** `{ "refreshToken": "eyJ..." }`

---

### GET /auth/me
Get the currently authenticated user's id and role.

**Auth:** Required  
**Response:** `{ "id": "uuid", "role": "supervisor" }`

---

### POST /auth/register-request
Submit a self-service account request (supervisor or vendor). Admin reviews before activation.

**Auth:** Public | **Rate limit:** 20 req / 15 min  
**Body:**
```json
{
  "role": "supervisor",
  "fullName": "...", "email": "...", "password": "...",
  "mobile": "9876543210", "companyName": "...", "gstin": "...", "address": "..."
}
```

---

### POST /auth/driver/request-otp
Send OTP to a driver's phone number.

**Auth:** Public | **Rate limit:** 5 req / 10 min (keyed by phone)  
**Body:** `{ "phone": "+919876543210" }`

---

### POST /auth/driver/register
Self-register as a driver using a vendor code. Sends OTP on success.

**Auth:** Public  
**Body:** `{ "phone": "...", "fullName": "...", "vendorCode": "VND-A1B2C3" }`

---

### POST /auth/driver/verify-otp
Verify OTP and receive driver tokens.

**Auth:** Public  
**Body:** `{ "phone": "+91...", "otp": "123456" }`  
**Response:** `{ "accessToken": "...", "refreshToken": "...", "driver": { "id": "...", "fullName": "...", "vendorId": "..." } }`

---

## Rides

### GET /rides
List rides, scoped by role.
- **Supervisor:** own rides only
- **Vendor:** rides belonging to their vendor
- **Driver:** rides assigned to them
- **Admin:** all rides

**Query:** `?status=broadcasting&limit=20&page=1`  
**Max limit:** 100

---

### POST /rides
Create and broadcast a new ride. **Supervisor only.**

**Body:**
```json
{
  "type": "login",
  "pickupPoint": { "lat": 12.97, "lng": 77.59 },
  "dropPoint": { "lat": 12.93, "lng": 77.62 },
  "pickupAddress": "Banashankari",
  "dropAddress": "WeWork Whitefield",
  "employeeIds": ["uuid1", "uuid2"],
  "vehicleType": "suv",
  "distanceKm": 14.9,
  "isAc": false,
  "capacity": 7,
  "plannedStartTime": "2026-07-30T08:30:00.000Z",
  "scheduledPickupTimes": { "empId1": "08:30", "empId2": "08:45" }
}
```
**Response:** `{ "ride": { "id": "...", "status": "broadcasting" }, "nearbyCount": 3 }`

---

### GET /rides/vehicle-options?lat=&lng=&pax=
Returns allowed vehicle types for a given passenger count, plus online count nearby.

**Auth:** Required  
**Response:** `{ "options": [{ "type": "suv", "allowed": true, "availableCount": 2 }] }`

---

### GET /rides/:id
Get a single ride. Ownership-scoped — see ride list scoping rules above.

---

### GET /rides/:id/detail
Full completed-ride detail including passengers, GPS trail, driver vehicle, timestamps.

**Auth:** Required (driver sees own rides only)  
**Response includes:** `passengers`, `locationTrail`, `driver`, `supervisor`, `plannedStartTime`, `startedAt`, `completedAt`, `driverReportingTime`

---

### GET /rides/:id/pax
Ordered passenger list with pickup/drop status. OTPs included for supervisor/admin.

**Auth:** Required (driver sees own ride only, supervisor sees own rides only)

---

### GET /rides/:id/driver-location
Current driver GPS position for live tracking.

**Auth:** Required (supervisor: own rides only)  
**Response:** `{ "lat": 12.97, "lng": 77.59 }`

---

### POST /rides/:id/accept
Driver accepts a broadcasting ride.

**Auth:** Driver only

---

### POST /rides/:id/reject
Driver rejects a broadcasting ride offer.

**Auth:** Driver only

---

### POST /rides/:id/assign
Supervisor/admin manually assigns a specific driver.

**Auth:** Supervisor or Admin  
**Body:** `{ "driverId": "uuid", "price": 750 }`

---

### POST /rides/:id/arrived
Driver confirms arrival at first pickup. Stamps `driver_reporting_time`.

**Auth:** Driver only (must be assigned to this ride)

---

### POST /rides/:id/claim
Driver claims an unassigned scheduled ride from the marketplace.

**Auth:** Driver only

---

### POST /rides/:id/release
Driver releases a claimed scheduled ride. ₹100 fine applied after 3h grace.

**Auth:** Driver only  
**Response:** `{ "fine": 100 }`

---

### PATCH /rides/:id/status
Advance ride through the state machine.

**Auth:** Driver, Supervisor, or Admin  
**Valid transitions:**
- `assigned` → `in_progress` (driver starts trip)
- `in_progress` → `completed` (driver completes trip)

**Body:** `{ "status": "in_progress" }`

---

### POST /rides/:id/cancel
Cancel a ride. Applies 5% cancellation fee if driver was assigned.

**Auth:** Supervisor or Admin  
**Response:** `{ "message": "Ride cancelled", "cancellationFee": 37.50 }`

---

### POST /rides/:id/force-cancel
Force-cancel a ride regardless of status (SOS context only).

**Auth:** Supervisor or Admin

---

### POST /rides/:id/rebroadcast
Re-broadcast an expired or cancelled ride.

**Auth:** Supervisor or Admin

---

### POST /rides/:id/pax/:paxId/pickup
Verify passenger pickup OTP.

**Auth:** Driver only  
**Body:** `{ "otp": "1234" }`

---

### POST /rides/:id/pax/:paxId/drop
Verify passenger drop OTP.

**Auth:** Driver only  
**Body:** `{ "otp": "5678" }`

---

### POST /rides/:id/pax/:paxId/no-show
Mark a passenger as no-show (didn't board).

**Auth:** Driver only

---

### GET /rides/:id/nearby-drivers?radius=10
List available drivers near the ride's pickup point (for manual assign).

**Auth:** Supervisor or Admin

---

## Driver (Driver App Endpoints)

All `/driver/*` endpoints require driver authentication.

### GET /driver/me
Driver profile including vendor, vehicle, wallet balance, expired docs.

### GET /driver/offers
Active ride broadcasts this driver can accept.  
**Refreshed:** every 8s by the app

### GET /driver/rides
This driver's ride history.

### GET /driver/scheduled
Scheduled rides available in the marketplace matching this driver's vehicle type.

### POST /driver/online
Go online. Requires `{ "lat": ..., "lng": ... }`. Starts GPS broadcast.

### POST /driver/location
Periodic GPS ping. Emits `driver:location_update` to supervisor via Socket.io for active rides.  
**Body:** `{ "lat": ..., "lng": ... }`

### POST /driver/offline
Go offline.

### POST /driver/vehicle
Set vehicle type and seat count.  
**Body:** `{ "vehicleType": "sedan", "seats": 5 }`

### GET /driver/documents
List this driver's KYC/vehicle documents.

### POST /driver/documents
Upload a KYC/vehicle document. Multipart form with `file` field.  
**Form fields:** `file`, `type` (aadhaar|dl|rc|puc|insurance|photo), `number`, `expiry`

### DELETE /driver/documents/:id
Delete a document.

---

## Drivers (Admin/Vendor)

### GET /drivers
List drivers. Vendor sees own drivers only.  
**Query:** `?vendorId=uuid&status=active&page=1&limit=20`

### POST /drivers
Create a driver. Vendor only.

### GET /drivers/:id
Get driver detail. Vendor sees own drivers; driver sees themselves; admin sees all.

### PATCH /drivers/:id/status
Update driver status: `pending|active|blacklisted|expired`.  
**Auth:** Vendor (own drivers) or Admin

### GET /drivers/:id/documents
List a driver's documents. Vendor (own driver) or Admin.

### PATCH /drivers/:id/documents/:docId
Verify or reject a KYC document.  
**Auth:** Vendor or Admin  
**Body:** `{ "status": "verified" }`

### GET /drivers/live-locations
All online drivers with current GPS. Used by admin live map.  
**Auth:** Admin only

---

## Employees

All employee endpoints are **Supervisor only**.

### GET /employees
List this supervisor's employees.  
**Query:** `?page=1&limit=50`

### POST /employees
Add a single employee.

### POST /employees/bulk
Bulk import employees (max 500).  
**Body:** Array of employee objects.

### GET /employees/:id
Get employee detail.

### PATCH /employees/:id
Update employee fields.

### DELETE /employees/:id
Delete an employee.

---

## Supervisor

### GET /supervisor/office
Get supervisor's office details (org, phone, officeLat/Lng, facility, pendingCancellationFee).

### PATCH /supervisor/phone
Update supervisor contact phone.  
**Body:** `{ "phone": "+919..." }`

### PATCH /supervisor/facility
Update facility/client code for OTD reports.  
**Body:** `{ "facility": "msi-MBlr" }`

### PATCH /supervisor/office
Update legacy single-office location.  
**Body:** `{ "lat": ..., "lng": ..., "address": "..." }`

### GET /supervisor/offices
List all saved office locations.

### POST /supervisor/offices
Add an office location.  
**Body:** `{ "name": "HQ", "address": "...", "lat": ..., "lng": ..., "isDefault": true, "gracePeriodSecs": 600 }`

### PATCH /supervisor/offices/:id
Update an office location. Pass `{ "isDefault": true }` to set as default.

### DELETE /supervisor/offices/:id
Delete an office location.

### GET /supervisor/route-templates
List saved route groups/templates.

### POST /supervisor/route-templates
Save a route template.  
**Body:** `{ "name": "Morning HSR", "rideType": "login", "vehicleType": "suv", "orderedEmployeeIds": ["uuid1"], "officeLocationId": "uuid" }`

### PATCH /supervisor/route-templates/:id
Update a template. Pass `{ "markUsed": true }` to stamp `lastUsedAt`.

### DELETE /supervisor/route-templates/:id
Delete a template.

### GET /supervisor/dashboard
Live dashboard data: KPIs, OTD trend (30 days), delay breakdown, ride volume (14 days), open issues.  
**Refreshed:** every 30s

### GET /supervisor/live-ops
Real-time ops board for today's rides with employee gender breakdown.  
Segments: `generated`, `yetToStart`, `notDownloaded`, `onTime`, `delayed`, `completedOnTime`  
**Refreshed:** every 15s

### GET /supervisor/reports/otd?from=YYYY-MM-DD&to=YYYY-MM-DD
OTD (On-Time Delivery) report. Returns one row per completed ride with all 25 columns matching the standard OTD report format.

### GET /supervisor/route-templates/report
Usage analytics for each saved group: total rides, completed rides, avg fare, last used.

---

## Vendors

All vendor endpoints are **Admin only** except `/vendor/profile`.

### GET /vendor/profile
Logged-in vendor's own name and vendor code.  
**Auth:** Vendor

### GET /vendors
List all vendors.

### POST /vendors
Create a vendor account. `userId` must belong to a user with role `vendor`.

### GET /vendors/:id
Get vendor detail.

### PATCH /vendors/:id
Update vendor.

### DELETE /vendors/:id
Delete vendor.

### GET /vendors/:id/stats
Vendor performance stats: driver count, ride count, revenue, pending payout.  
**Auth:** Admin or Vendor (own)

### GET /vendors/by-code/:code [Public]
Look up a vendor by code (e.g. `VND-A1B2C3`). Used by drivers during self-registration.  
**Response:** `{ "id": "...", "name": "...", "vendorCode": "VND-A1B2C3" }`

---

## Vehicles

### GET /vehicles
List vehicles. Vendor sees own only.

### POST /vehicles
Create vehicle. Vendor only.

### GET /vehicles/:id
Get vehicle. Vendor scoped.

### PATCH /vehicles/:id
Update vehicle. Vendor only.

### DELETE /vehicles/:id
Delete vehicle. Vendor only.

---

## Payouts (Admin → Vendor)

### GET /payouts
List payouts. Vendor sees own; admin sees all.  
**Query:** `?vendorId=uuid&status=pending&page=1`

### POST /payouts
Create a payout record for a vendor.  
**Auth:** Admin  
**Body (JSON or multipart):** `{ "vendorId": "uuid", "period": "2026-07", "ratePerRide": 150 }`

### PATCH /payouts/:id/file
Attach an invoice/proof file to a payout.  
**Auth:** Admin  
**Multipart:** `file` field

### PATCH /payouts/:id/status
Mark a payout as paid.  
**Auth:** Admin

### GET /payouts/ride-count?vendorId=&period=YYYY-MM
Count completed rides for a vendor in a period (for payout calculation preview).  
**Auth:** Admin

---

## Payments (Supervisor → Driver)

### GET /payments/pending
Completed rides awaiting payment by this supervisor.

### POST /payments/rides/:id/initiate
Create a Razorpay order for the ride fare. Returns checkout data.  
**Auth:** Supervisor  
**Response:** `{ "orderId": "order_xxx", "amount": 77000, "currency": "INR", "keyId": "rzp_...", "driverFare": 750, "platformFee": 20, "totalAmount": 770 }`

### POST /payments/rides/:id/confirm
Confirm payment after Razorpay checkout. Verifies signature, triggers Route transfer, credits driver wallet.  
**Auth:** Supervisor  
**Body:** `{ "razorpayPaymentId": "pay_xxx", "razorpaySignature": "..." }`

### POST /payments/webhook
Razorpay webhook receiver. Verifies `x-razorpay-signature` header. Handles `payment.captured` event.  
**Auth:** Public (signature-verified)

### POST /payments/driver/onboard
Step 1: Create a Razorpay Route linked account for this driver.  
**Auth:** Driver

### POST /payments/driver/onboard/bank
Step 2: Submit UPI ID or bank account for Razorpay verification.  
**Auth:** Driver  
**Body:** `{ "upiId": "name@ybl" }` or `{ "accountNo": "...", "ifsc": "HDFC0001234", "accountName": "..." }`

### GET /payments/driver/onboard/status
Check Razorpay account verification status.  
**Auth:** Driver  
**Response:** `{ "step": "complete", "verified": true }`

### GET /payments/bank-detail
Driver's saved bank/UPI details.  
**Auth:** Driver

### POST /payments/bank-detail
Save/update driver bank/UPI details.  
**Auth:** Driver

### GET /payments/wallet
Driver wallet balance and last 20 payments.  
**Auth:** Driver

---

## Issues & SOS

### GET /issues
List issues scoped by role:
- Supervisor: issues they raised
- Vendor: issues for their drivers
- Admin: all issues
- Driver: their own SOS issues

### POST /issues
Supervisor raises an issue about a driver/ride.  
**Auth:** Supervisor  
**Body:** `{ "rideId": "uuid", "description": "Driver was rash..." }`

### POST /issues/sos
Driver triggers an SOS alert. Notifies supervisor via Socket.io immediately.  
**Auth:** Driver  
**Body:** `{ "issueType": "vehicle_issue", "description": "Tyre puncture", "rideId": "uuid" }`

### POST /issues/:id/sos-rebook
Cancel the SOS ride and create a new broadcasting ride for remaining passengers.  
**Auth:** Supervisor  
**Response:** `{ "newRideId": "...", "nearbyCount": 3, "employeeCount": 2, "boardedCount": 1 }`

### GET /issues/:id/driver-location
Driver's current GPS position (SOS issues only).  
**Auth:** Supervisor

### GET /issues/:id/messages
Chat messages for this issue thread.  
**Auth:** Supervisor, Vendor, Admin, or the Driver on their own SOS

### POST /issues/:id/messages
Send a message in the issue chat. Delivered via Socket.io in real time.  
**Auth:** Supervisor, Vendor, Admin, or Driver (own SOS)  
**Body:** `{ "body": "Help is on the way." }`

### PATCH /issues/:id
Resolve or reopen an issue.  
**Auth:** Supervisor (own issues) or Admin  
**Body:** `{ "status": "resolved" }`

---

## Safety Incidents

### GET /safety/incidents
List safety incidents.  
**Auth:** Admin or Supervisor

### POST /safety/incidents
Report a safety incident for a ride.  
**Auth:** Assigned driver, ride's supervisor, or admin  
**Body:** `{ "rideId": "uuid", "description": "Passenger reported unsafe driving..." }`

### PATCH /safety/incidents/:id
Update incident status.  
**Auth:** Admin  
**Body:** `{ "status": "investigating" }`

---

## Analytics

All analytics endpoints are **Admin only**.

### GET /analytics/overview
Platform-wide KPIs: total rides, active drivers, total vendors, total revenue, rides by status.  
**Refreshed:** every 15s

### GET /analytics/rides?period=YYYY-MM
Ride analytics: by status, by type, total revenue, average price, completed count.

### GET /analytics/vendors/:id/performance
Vendor performance: drivers by status, rides by status, total revenue, avg driver rating.

---

## Admin

### GET /admin/tenants
List all supervisor accounts.  
**Auth:** Admin

### POST /admin/tenants
Create a supervisor account directly (bypasses registration approval).  
**Body:** `{ "company": "TechCorp", "fullName": "Jane", "email": "...", "password": "..." }`

### PATCH /admin/tenants/:id
Activate or deactivate a supervisor.  
**Body:** `{ "isActive": false }`

### POST /admin/vendors
Create a vendor account with linked user.  
**Body:** `{ "company": "...", "contactName": "...", "contactEmail": "...", "contactPhone": "...", "email": "...", "password": "..." }`

### GET /admin/registration-requests?status=pending
List self-service account requests.

### PATCH /admin/registration-requests/:id
Approve or reject a registration request. On approval, creates the account and notifies by email.  
**Body:** `{ "decision": "approved", "reviewNote": "Welcome!" }`

---

## Files

### GET /files/:filename
Serve an uploaded file (KYC document, invoice, etc.)  
**Auth:** Valid access token via `Authorization` header or `?token=` query param  
**Rate limit:** 60 req / min  
**Note:** Filename is sanitized to prevent path traversal.

---

## Health

### GET /health [Public]
Server health check. Pings Postgres and Redis.  
**Response (healthy):** `{ "status": "ok", "timestamp": "2026-07-30T..." }`  
**Response (degraded):** HTTP 503 `{ "status": "degraded", "error": "..." }`

---

## Socket.io Namespaces

The app uses Socket.io for real-time events. Connect with a valid access token:

```js
import { io } from 'socket.io-client';
const socket = io('/supervisor', { auth: { token: accessToken } });
```

### /supervisor namespace

| Event (received) | Payload | When |
|---|---|---|
| `driver:accepted` | `{ rideId, driverId }` | Driver accepts a broadcast |
| `ride:status_changed` | `{ rideId, status }` | Ride status changes |
| `driver:location_update` | `{ rideId, driverId, lat, lng, ts }` | Driver GPS ping (every ~5s while active) |
| `sos:alert` | `{ issueId, issueType, description, driverName, driverPhone, location }` | Driver triggers SOS |
| `sos:rebook_complete` | `{ issueId, newRideId, nearbyCount, employeeCount }` | SOS rebook succeeded |
| `issue:message` | `{ issueId, message }` | New chat message |

### /driver namespace

| Event (received) | Payload | When |
|---|---|---|
| `ride:broadcast` | Ride payload | New ride available to claim |
| `issue:message` | `{ issueId, message }` | Supervisor sent SOS chat message |

### /admin namespace

| Event (received) | Payload | When |
|---|---|---|
| `admin:activity` | `{ event, rideId, ... }` | Any significant platform event |

---

## Rate Limits

| Scope | Limit |
|---|---|
| Global | 500 req / 15 min |
| Auth (login, register) | 20 req / 15 min |
| Token refresh | 30 req / 15 min |
| OTP request | 5 req / 10 min (per phone) |
| File serving | 60 req / min |

---

## Error Response Format

All errors follow this shape:

```json
{ "error": "Human-readable message", "code": "SNAKE_CASE_CODE" }
```

Common codes: `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `VALIDATION_ERROR`, `TOO_MANY_REQUESTS`

HTTP status codes used: `400`, `401`, `403`, `404`, `409`, `422`, `429`, `500`, `503`
