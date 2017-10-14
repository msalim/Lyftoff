/* delta_lyftoff.js 
 * Goal: people don't need to wait for their Lyft when they reach the Lyftstop.
 * Creates a structure to automatically queues passenger to a Lyft when they've
 * landed + time to walk to Lyft - time required to wait for Lyft.
 * Passengers will need to mark that they want a Lyft.
 * Passengers aren't paired up to a specific Lyft until they meet up with the
 * driver. This is so that passengers can freely schedule themselves (e.g.
 * for baggage, restroom) instead of being rushed to catch the Lyft.
 * Passengers queue similarly as if they are queueing on a taxi line,
 * and they will need to present a QR code for the drivers. Drivers will need
 * to scan the passenger's QR code confirming that they are a Delta passenger.
 * Then, passenger and driver is paired.
 * Using Lyft dispatch, for example.
 *
 * Our algorithm proceeds as follows.
 * Prereqs: - Add a "Delta+Lyft" line at airport
 *          - Acquire data for baggage claim times
 *          
 * Passenger is offered a "book a Lyft automatically as I land" button.
 * If they request one, give them a QR code to show to the driver later on.
 * On Delta's side, we dispatch a Lyft for the customer at this time:
 * - When the plane lands
 * - If customer has baggage checked in: the time the baggage will go out
 *   + the time it takes to walk from baggage claim to Lyft stop
 * - If customer has no checked in baggage: the time it takes to go from gate
 *   to the Lyft stop
 * - Check estimates on Lyft; dispatch a Lyft when the estimated wait time
 *   plus the current time would add up to the expected time the customer
 *   reaches the Lyft stop.
 * The neat thing about having a pool instead of one-passenger-to-one-Lyft
 * is that this takes care of the "baggage wait" issue. Since we don't 
 * really know the order of which the baggage comes out, on the one-to-one
 * model, some Lyfts will need to wait for their customers, and some customers
 * won't have a Lyft ready for a while if we order Z number of Lyfts at an E[X].
 * Using the pool model, however, and since we know that:
 * - Baggages come out at a constant rate, so say it's expected for one
 *   passenger to finish baggage claim every 10 second
 * We can simply dispatch a Lyft every 10 second.
 * This model also allows people to take breaks (e.g. use the restroom, etc.).
 * On regular and peak times (e.g. with 10 lyfts per minute or even more),
 * one customer's delay will be entirely mitigated by other customer's demand,
 * since the Lyfts are also taken as first-come-first-served.
 */

// lyftoff.js
