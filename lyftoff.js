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
 * Passenger is offered a "book a Lyft for after I land" button.
 * If they request one, give them a QR code to show to the driver later on,
 * and tell them that everything has been taken care for.
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
 * 
 * We simulate a delayed-flyer by increasing the pickup time such that they're not
 * ready even when the Lyft has already there. In real life, this can be checked
 * using GPS / cell location.
 */

// lyftoff.js

// the customer object contains
// - the flight the customer is taking customer["flight"]
// - whether the customer has baggage customer["hasBaggage"]
// - whether the customer needs additional assistance customer["needAssistance"]
// - if the customer requests extra time customer["extraTime"]

// the flight object contains flight details, including when it landed
// and customers in the flight queue
// organized by flight since flight time may change. use
// a heap to pop off flights as they land. 

const Lyft = require("node-lyft");
const Minheap = require("minheap");
const request = require("request");

const pollFrequency = 10; // seconds per poll
const lyftAPIToken = "mD6RQO8YOCVEtO3yt8L6PJsO0o9u2WWHNEoAotlvoNlt9OBJyY/jn/o25etTq/SXw0hwcdAYLB0eLlTOKYVfjDNiQ6IpSenMsU7LdOtiC5y9UUyNvUKoqUM=";
const demoBaseTime = 64800; // 6pm, in seconds
const timeInterval = 60; // step by a minute each time
var currentTime = demoBaseTime+30*60; // seconds

const probabilityDelayed = 0.05;
const timeToAddWhenDelayed = 6 * 60;
const pairingTimeThreshold = 3 * 60;

var lyftID = 0;

var flightOneWaiting = 0;
var flightTwoWaiting = 0;
var flightThreeWaiting = 0;

const compareFlyerFn = (flyer1, flyer2) => {
    return flyer1.pickupTime-flyer2.pickupTime;
}

const compareFlightFn = (flight1, flight2) => {
    return flight1.arrivalTime-flight2.arrivalTime;
}

const compareLyftFn = (lyft1, lyft2) => {
    return lyft1.pickupTime-lyft2.pickupTime;
}

const _flyerHeap = new Minheap(compareFlyerFn);
const _flightHeap = new Minheap(compareFlightFn);
const _lyftHeaps = [new Minheap(compareLyftFn), new Minheap(compareLyftFn), new Minheap(compareLyftFn), new Minheap(compareLyftFn), new Minheap(compareLyftFn), new Minheap(compareLyftFn)];
const _flyerLyftDispatchedHeaps = [new Minheap(compareFlyerFn), new Minheap(compareFlyerFn), new Minheap(compareFlyerFn), new Minheap(compareFlyerFn), new Minheap(compareFlyerFn), new Minheap(compareFlyerFn)];
const _flyerLyftDispatchedSet = new Set(); // for the "paired" algorithm

const flights = [{
    "flightNumber": 1560,
    "departureGate": null,
    "departureTime": null,
    "arrivalGate": "C37",
    "arrivalTime": demoBaseTime+45*60,
    "flyerList": [{"id": 0, "flightNumber": 1560, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 1, "flightNumber": 1560, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 2, "flightNumber": 1560, "hasBaggage": false, "needAssistance": false, "lyftPreference": 2}, {"id": 3, "flightNumber": 1560, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 4, "flightNumber": 1560, "hasBaggage": true, "needAssistance": false, "lyftPreference": -1}, {"id": 5, "flightNumber": 1560, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 6, "flightNumber": 1560, "hasBaggage": true, "needAssistance": false, "lyftPreference": -1}, {"id": 7, "flightNumber": 1560, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 8, "flightNumber": 1560, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 9, "flightNumber": 1560, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 10, "flightNumber": 1560, "hasBaggage": false, "needAssistance": false, "lyftPreference": 2}, {"id": 11, "flightNumber": 1560, "hasBaggage": true, "needAssistance": false, "lyftPreference": -1}, {"id": 12, "flightNumber": 1560, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 13, "flightNumber": 1560, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 14, "flightNumber": 1560, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 15, "flightNumber": 1560, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 16, "flightNumber": 1560, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 17, "flightNumber": 1560, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 18, "flightNumber": 1560, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 19, "flightNumber": 1560, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 20, "flightNumber": 1560, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 21, "flightNumber": 1560, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 22, "flightNumber": 1560, "hasBaggage": true, "needAssistance": false, "lyftPreference": -1}, {"id": 23, "flightNumber": 1560, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 24, "flightNumber": 1560, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 25, "flightNumber": 1560, "hasBaggage": true, "needAssistance": false, "lyftPreference": -1}, {"id": 26, "flightNumber": 1560, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 27, "flightNumber": 1560, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 28, "flightNumber": 1560, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 29, "flightNumber": 1560, "hasBaggage": false, "needAssistance": false, "lyftPreference": 2}, {"id": 30, "flightNumber": 1560, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 31, "flightNumber": 1560, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 32, "flightNumber": 1560, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 33, "flightNumber": 1560, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 34, "flightNumber": 1560, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 35, "flightNumber": 1560, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 36, "flightNumber": 1560, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 37, "flightNumber": 1560, "hasBaggage": false, "needAssistance": false, "lyftPreference": 2}, {"id": 38, "flightNumber": 1560, "hasBaggage": false, "needAssistance": false, "lyftPreference": 2}, {"id": 39, "flightNumber": 1560, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 40, "flightNumber": 1560, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 41, "flightNumber": 1560, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 42, "flightNumber": 1560, "hasBaggage": true, "needAssistance": false, "lyftPreference": -1}, {"id": 43, "flightNumber": 1560, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 44, "flightNumber": 1560, "hasBaggage": false, "needAssistance": false, "lyftPreference": 2}, {"id": 45, "flightNumber": 1560, "hasBaggage": true, "needAssistance": true, "lyftPreference": 2}, {"id": 46, "flightNumber": 1560, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 47, "flightNumber": 1560, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 48, "flightNumber": 1560, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 49, "flightNumber": 1560, "hasBaggage": true, "needAssistance": false, "lyftPreference": -1}, {"id": 50, "flightNumber": 1560, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 51, "flightNumber": 1560, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 52, "flightNumber": 1560, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 53, "flightNumber": 1560, "hasBaggage": false, "needAssistance": true, "lyftPreference": -1}, {"id": 54, "flightNumber": 1560, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 55, "flightNumber": 1560, "hasBaggage": true, "needAssistance": false, "lyftPreference": -1}, {"id": 56, "flightNumber": 1560, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 57, "flightNumber": 1560, "hasBaggage": true, "needAssistance": false, "lyftPreference": 2}, {"id": 58, "flightNumber": 1560, "hasBaggage": true, "needAssistance": false, "lyftPreference": -1}, {"id": 59, "flightNumber": 1560, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 60, "flightNumber": 1560, "hasBaggage": false, "needAssistance": false, "lyftPreference": 2}, {"id": 61, "flightNumber": 1560, "hasBaggage": false, "needAssistance": false, "lyftPreference": 2}, {"id": 62, "flightNumber": 1560, "hasBaggage": true, "needAssistance": false, "lyftPreference": -1}, {"id": 63, "flightNumber": 1560, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 64, "flightNumber": 1560, "hasBaggage": false, "needAssistance": false, "lyftPreference": 2}, {"id": 65, "flightNumber": 1560, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 66, "flightNumber": 1560, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 67, "flightNumber": 1560, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 68, "flightNumber": 1560, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 69, "flightNumber": 1560, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 70, "flightNumber": 1560, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 71, "flightNumber": 1560, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 72, "flightNumber": 1560, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 73, "flightNumber": 1560, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 74, "flightNumber": 1560, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 75, "flightNumber": 1560, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 76, "flightNumber": 1560, "hasBaggage": true, "needAssistance": false, "lyftPreference": -1}, {"id": 77, "flightNumber": 1560, "hasBaggage": true, "needAssistance": false, "lyftPreference": -1}, {"id": 78, "flightNumber": 1560, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 79, "flightNumber": 1560, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 80, "flightNumber": 1560, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 81, "flightNumber": 1560, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 82, "flightNumber": 1560, "hasBaggage": true, "needAssistance": false, "lyftPreference": 2}, {"id": 83, "flightNumber": 1560, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 84, "flightNumber": 1560, "hasBaggage": true, "needAssistance": false, "lyftPreference": -1}, {"id": 85, "flightNumber": 1560, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 86, "flightNumber": 1560, "hasBaggage": false, "needAssistance": false, "lyftPreference": 2}, {"id": 87, "flightNumber": 1560, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 88, "flightNumber": 1560, "hasBaggage": true, "needAssistance": false, "lyftPreference": -1}, {"id": 89, "flightNumber": 1560, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 90, "flightNumber": 1560, "hasBaggage": true, "needAssistance": false, "lyftPreference": -1}, {"id": 91, "flightNumber": 1560, "hasBaggage": true, "needAssistance": false, "lyftPreference": -1}, {"id": 92, "flightNumber": 1560, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 93, "flightNumber": 1560, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 94, "flightNumber": 1560, "hasBaggage": true, "needAssistance": false, "lyftPreference": -1}, {"id": 95, "flightNumber": 1560, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 96, "flightNumber": 1560, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 97, "flightNumber": 1560, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 98, "flightNumber": 1560, "hasBaggage": true, "needAssistance": false, "lyftPreference": 2}, {"id": 99, "flightNumber": 1560, "hasBaggage": true, "needAssistance": false, "lyftPreference": -1}, {"id": 100, "flightNumber": 1560, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 101, "flightNumber": 1560, "hasBaggage": true, "needAssistance": false, "lyftPreference": 2}, {"id": 102, "flightNumber": 1560, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 103, "flightNumber": 1560, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 104, "flightNumber": 1560, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 105, "flightNumber": 1560, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 106, "flightNumber": 1560, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 107, "flightNumber": 1560, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 108, "flightNumber": 1560, "hasBaggage": true, "needAssistance": false, "lyftPreference": -1}, {"id": 109, "flightNumber": 1560, "hasBaggage": true, "needAssistance": false, "lyftPreference": 2}, {"id": 110, "flightNumber": 1560, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 111, "flightNumber": 1560, "hasBaggage": true, "needAssistance": false, "lyftPreference": 2}, {"id": 112, "flightNumber": 1560, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 113, "flightNumber": 1560, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 114, "flightNumber": 1560, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 115, "flightNumber": 1560, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 116, "flightNumber": 1560, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 117, "flightNumber": 1560, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 118, "flightNumber": 1560, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 119, "flightNumber": 1560, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 120, "flightNumber": 1560, "hasBaggage": false, "needAssistance": false, "lyftPreference": 2}, {"id": 121, "flightNumber": 1560, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 122, "flightNumber": 1560, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 123, "flightNumber": 1560, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 124, "flightNumber": 1560, "hasBaggage": true, "needAssistance": false, "lyftPreference": -1}, {"id": 125, "flightNumber": 1560, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 126, "flightNumber": 1560, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 127, "flightNumber": 1560, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 128, "flightNumber": 1560, "hasBaggage": true, "needAssistance": false, "lyftPreference": -1}, {"id": 129, "flightNumber": 1560, "hasBaggage": false, "needAssistance": true, "lyftPreference": -1}, {"id": 130, "flightNumber": 1560, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 131, "flightNumber": 1560, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 132, "flightNumber": 1560, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 133, "flightNumber": 1560, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 134, "flightNumber": 1560, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 135, "flightNumber": 1560, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 136, "flightNumber": 1560, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 137, "flightNumber": 1560, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 138, "flightNumber": 1560, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 139, "flightNumber": 1560, "hasBaggage": true, "needAssistance": false, "lyftPreference": -1}, {"id": 140, "flightNumber": 1560, "hasBaggage": true, "needAssistance": false, "lyftPreference": -1}, {"id": 141, "flightNumber": 1560, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 142, "flightNumber": 1560, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 143, "flightNumber": 1560, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 144, "flightNumber": 1560, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 145, "flightNumber": 1560, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 146, "flightNumber": 1560, "hasBaggage": false, "needAssistance": false, "lyftPreference": 2}, {"id": 147, "flightNumber": 1560, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 148, "flightNumber": 1560, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}]
},
{
    "flightNumber": 1159,
    "departureGate": null,
    "departureTime": null,
    "arrivalGate": "B36",
    "arrivalTime": demoBaseTime+36*60,
    "flyerList": [{"id": 149, "flightNumber": 1159, "hasBaggage": true, "needAssistance": false, "lyftPreference": 2}, {"id": 150, "flightNumber": 1159, "hasBaggage": true, "needAssistance": false, "lyftPreference": 2}, {"id": 151, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 152, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": 2}, {"id": 153, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 154, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 155, "flightNumber": 1159, "hasBaggage": true, "needAssistance": false, "lyftPreference": -1}, {"id": 156, "flightNumber": 1159, "hasBaggage": true, "needAssistance": false, "lyftPreference": -1}, {"id": 157, "flightNumber": 1159, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 158, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 159, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 160, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 161, "flightNumber": 1159, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 162, "flightNumber": 1159, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 163, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 164, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": 2}, {"id": 165, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 166, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 167, "flightNumber": 1159, "hasBaggage": true, "needAssistance": false, "lyftPreference": -1}, {"id": 168, "flightNumber": 1159, "hasBaggage": true, "needAssistance": false, "lyftPreference": -1}, {"id": 169, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 170, "flightNumber": 1159, "hasBaggage": true, "needAssistance": false, "lyftPreference": -1}, {"id": 171, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 172, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 173, "flightNumber": 1159, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 174, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 175, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 176, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": 2}, {"id": 177, "flightNumber": 1159, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 178, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": 2}, {"id": 179, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 180, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 181, "flightNumber": 1159, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 182, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 183, "flightNumber": 1159, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 184, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": 2}, {"id": 185, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 186, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 187, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 188, "flightNumber": 1159, "hasBaggage": true, "needAssistance": false, "lyftPreference": -1}, {"id": 189, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 190, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 191, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 192, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 193, "flightNumber": 1159, "hasBaggage": true, "needAssistance": false, "lyftPreference": -1}, {"id": 194, "flightNumber": 1159, "hasBaggage": true, "needAssistance": false, "lyftPreference": -1}, {"id": 195, "flightNumber": 1159, "hasBaggage": true, "needAssistance": false, "lyftPreference": -1}, {"id": 196, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 197, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 198, "flightNumber": 1159, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 199, "flightNumber": 1159, "hasBaggage": true, "needAssistance": false, "lyftPreference": -1}, {"id": 200, "flightNumber": 1159, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 201, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 202, "flightNumber": 1159, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 203, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 204, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 205, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 206, "flightNumber": 1159, "hasBaggage": true, "needAssistance": false, "lyftPreference": -1}, {"id": 207, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 208, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 209, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 210, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 211, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 212, "flightNumber": 1159, "hasBaggage": true, "needAssistance": false, "lyftPreference": -1}, {"id": 213, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 214, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": 2}, {"id": 215, "flightNumber": 1159, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 216, "flightNumber": 1159, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 217, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 218, "flightNumber": 1159, "hasBaggage": true, "needAssistance": false, "lyftPreference": -1}, {"id": 219, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 220, "flightNumber": 1159, "hasBaggage": false, "needAssistance": true, "lyftPreference": 1}, {"id": 221, "flightNumber": 1159, "hasBaggage": false, "needAssistance": true, "lyftPreference": -1}, {"id": 222, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 223, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 224, "flightNumber": 1159, "hasBaggage": true, "needAssistance": false, "lyftPreference": -1}, {"id": 225, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 226, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 227, "flightNumber": 1159, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 228, "flightNumber": 1159, "hasBaggage": true, "needAssistance": false, "lyftPreference": -1}, {"id": 229, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 230, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 231, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 232, "flightNumber": 1159, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 233, "flightNumber": 1159, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 234, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 235, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 236, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 237, "flightNumber": 1159, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 238, "flightNumber": 1159, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 239, "flightNumber": 1159, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 240, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 241, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 242, "flightNumber": 1159, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 243, "flightNumber": 1159, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 244, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": 2}, {"id": 245, "flightNumber": 1159, "hasBaggage": true, "needAssistance": false, "lyftPreference": -1}, {"id": 246, "flightNumber": 1159, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 247, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 248, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 249, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 250, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 251, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 252, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 253, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 254, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 255, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 256, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 257, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 258, "flightNumber": 1159, "hasBaggage": false, "needAssistance": true, "lyftPreference": 2}, {"id": 259, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 260, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 261, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 262, "flightNumber": 1159, "hasBaggage": true, "needAssistance": false, "lyftPreference": 2}, {"id": 263, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 264, "flightNumber": 1159, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 265, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": 2}, {"id": 266, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 267, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 268, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 269, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 270, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 271, "flightNumber": 1159, "hasBaggage": true, "needAssistance": false, "lyftPreference": -1}, {"id": 272, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 273, "flightNumber": 1159, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 274, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": 2}, {"id": 275, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 276, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 277, "flightNumber": 1159, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 278, "flightNumber": 1159, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 279, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 280, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 281, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 282, "flightNumber": 1159, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 283, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": 2}, {"id": 284, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 285, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 286, "flightNumber": 1159, "hasBaggage": true, "needAssistance": false, "lyftPreference": -1}, {"id": 287, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": 2}, {"id": 288, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": 2}, {"id": 289, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 290, "flightNumber": 1159, "hasBaggage": true, "needAssistance": false, "lyftPreference": 2}, {"id": 291, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": 2}, {"id": 292, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 293, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 294, "flightNumber": 1159, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 295, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 296, "flightNumber": 1159, "hasBaggage": true, "needAssistance": false, "lyftPreference": -1}, {"id": 297, "flightNumber": 1159, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}]    
},
{
    "flightNumber": 906,
    "departureGate": null,
    "departureTime": null,
    "arrivalGate": "E8",
    "arrivalTime": demoBaseTime+48*60,
    "flyerList": [{"id": 298, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 299, "flightNumber": 906, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 300, "flightNumber": 906, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 301, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 302, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 303, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 304, "flightNumber": 906, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 305, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 306, "flightNumber": 906, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 307, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": -1}, {"id": 308, "flightNumber": 906, "hasBaggage": false, "needAssistance": false, "lyftPreference": 2}, {"id": 309, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 310, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 311, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": 2}, {"id": 312, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": 2}, {"id": 313, "flightNumber": 906, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 314, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": -1}, {"id": 315, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": 2}, {"id": 316, "flightNumber": 906, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 317, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 318, "flightNumber": 906, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 319, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 320, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 321, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 322, "flightNumber": 906, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 323, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 324, "flightNumber": 906, "hasBaggage": false, "needAssistance": false, "lyftPreference": 2}, {"id": 325, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 326, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": 2}, {"id": 327, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": 2}, {"id": 328, "flightNumber": 906, "hasBaggage": false, "needAssistance": false, "lyftPreference": 2}, {"id": 329, "flightNumber": 906, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 330, "flightNumber": 906, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 331, "flightNumber": 906, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 332, "flightNumber": 906, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 333, "flightNumber": 906, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 334, "flightNumber": 906, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 335, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 336, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": -1}, {"id": 337, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 338, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": 2}, {"id": 339, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": -1}, {"id": 340, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 341, "flightNumber": 906, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 342, "flightNumber": 906, "hasBaggage": true, "needAssistance": true, "lyftPreference": -1}, {"id": 343, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": -1}, {"id": 344, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": 2}, {"id": 345, "flightNumber": 906, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 346, "flightNumber": 906, "hasBaggage": true, "needAssistance": true, "lyftPreference": 2}, {"id": 347, "flightNumber": 906, "hasBaggage": false, "needAssistance": false, "lyftPreference": 2}, {"id": 348, "flightNumber": 906, "hasBaggage": false, "needAssistance": false, "lyftPreference": 2}, {"id": 349, "flightNumber": 906, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 350, "flightNumber": 906, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 351, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 352, "flightNumber": 906, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 353, "flightNumber": 906, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 354, "flightNumber": 906, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 355, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": -1}, {"id": 356, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": 2}, {"id": 357, "flightNumber": 906, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 358, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": -1}, {"id": 359, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 360, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": -1}, {"id": 361, "flightNumber": 906, "hasBaggage": false, "needAssistance": false, "lyftPreference": 2}, {"id": 362, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": -1}, {"id": 363, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 364, "flightNumber": 906, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 365, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 366, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 367, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": -1}, {"id": 368, "flightNumber": 906, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 369, "flightNumber": 906, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 370, "flightNumber": 906, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 371, "flightNumber": 906, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 372, "flightNumber": 906, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 373, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": -1}, {"id": 374, "flightNumber": 906, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 375, "flightNumber": 906, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 376, "flightNumber": 906, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 377, "flightNumber": 906, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 378, "flightNumber": 906, "hasBaggage": false, "needAssistance": false, "lyftPreference": 2}, {"id": 379, "flightNumber": 906, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 380, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": -1}, {"id": 381, "flightNumber": 906, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 382, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": -1}, {"id": 383, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": -1}, {"id": 384, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": -1}, {"id": 385, "flightNumber": 906, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 386, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": -1}, {"id": 387, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 388, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": 2}, {"id": 389, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": -1}, {"id": 390, "flightNumber": 906, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 391, "flightNumber": 906, "hasBaggage": false, "needAssistance": false, "lyftPreference": 2}, {"id": 392, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 393, "flightNumber": 906, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 394, "flightNumber": 906, "hasBaggage": false, "needAssistance": true, "lyftPreference": -1}, {"id": 395, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": 2}, {"id": 396, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 397, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": -1}, {"id": 398, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": -1}, {"id": 399, "flightNumber": 906, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 400, "flightNumber": 906, "hasBaggage": false, "needAssistance": false, "lyftPreference": 2}, {"id": 401, "flightNumber": 906, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 402, "flightNumber": 906, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 403, "flightNumber": 906, "hasBaggage": true, "needAssistance": true, "lyftPreference": 1}, {"id": 404, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": 2}, {"id": 405, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": 2}, {"id": 406, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 407, "flightNumber": 906, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 408, "flightNumber": 906, "hasBaggage": false, "needAssistance": false, "lyftPreference": 2}, {"id": 409, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 410, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": -1}, {"id": 411, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": -1}, {"id": 412, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": -1}, {"id": 413, "flightNumber": 906, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 414, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": -1}, {"id": 415, "flightNumber": 906, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 416, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 417, "flightNumber": 906, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 418, "flightNumber": 906, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 419, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 420, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 421, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": -1}, {"id": 422, "flightNumber": 906, "hasBaggage": false, "needAssistance": true, "lyftPreference": -1}, {"id": 423, "flightNumber": 906, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 424, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 425, "flightNumber": 906, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 426, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 427, "flightNumber": 906, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 428, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 429, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 430, "flightNumber": 906, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 431, "flightNumber": 906, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 432, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 433, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 434, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": 2}, {"id": 435, "flightNumber": 906, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 436, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 437, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 438, "flightNumber": 906, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 439, "flightNumber": 906, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 440, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": 2}, {"id": 441, "flightNumber": 906, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 442, "flightNumber": 906, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 443, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 444, "flightNumber": 906, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 445, "flightNumber": 906, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 446, "flightNumber": 906, "hasBaggage": false, "needAssistance": false, "lyftPreference": 2}, {"id": 447, "flightNumber": 906, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 448, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": 2}, {"id": 449, "flightNumber": 906, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 450, "flightNumber": 906, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 451, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 452, "flightNumber": 906, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 453, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 454, "flightNumber": 906, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 455, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": 2}, {"id": 456, "flightNumber": 906, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 457, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": 2}, {"id": 458, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": -1}, {"id": 459, "flightNumber": 906, "hasBaggage": false, "needAssistance": false, "lyftPreference": 2}, {"id": 460, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 461, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": -1}, {"id": 462, "flightNumber": 906, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 463, "flightNumber": 906, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 464, "flightNumber": 906, "hasBaggage": false, "needAssistance": false, "lyftPreference": 1}, {"id": 465, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": -1}, {"id": 466, "flightNumber": 906, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 467, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 468, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": -1}, {"id": 469, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": -1}, {"id": 470, "flightNumber": 906, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 471, "flightNumber": 906, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 472, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 473, "flightNumber": 906, "hasBaggage": true, "needAssistance": false, "lyftPreference": 1}, {"id": 474, "flightNumber": 906, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}, {"id": 475, "flightNumber": 906, "hasBaggage": false, "needAssistance": false, "lyftPreference": 2}, {"id": 476, "flightNumber": 906, "hasBaggage": false, "needAssistance": false, "lyftPreference": 2}, {"id": 477, "flightNumber": 906, "hasBaggage": false, "needAssistance": false, "lyftPreference": -1}]
}];

/* flight contains:
 * - flight number
 * - departure gate, updated real-time
 * - estimated departure time, updated real-time
 * - arrival gate, updated real-time
 * - estimated arrival time, updated real-time
 * - list of customers boarded
 * flight : objectOf {
 *   flightNumber : number,
 *   departureGate : string,
 *   departureTime : number,
 *   arrivalGate: string,
 *   arrivalTime : number,
 *   flyerList : array of flyers
 *   },
 * flyer : objectOf {
 *   id : number,
 *   flightNumber : number,
 *   hasBaggage : boolean,
 *   needAssistance : boolean,
 *   extraTime : number,
 *   lyftPreference: number, // 0 = line, 1 = lyft, 2 = plus, 3 = premier, 4 = lux, 5 = luxsuv
 *   pickupTime : number
 *   }
 * lyft : objectOf {
 *   type : number, // 1 for Lyft, 2 for Lyft Plus
 *   pickupTime: number
 * }
 */


const isDelayed = (p) => {
    let res = Math.random();
    return (res < p);
};

// returns a number that calculates gate to terminal
const calculateTime = (source, destination, flyerNumber) => {
    if (source == "B36") {
        if (destination == "lyft") {
            return 24 * 60 + flyerNumber * 5; // add deplaning
        }
        else if (destination == "baggage") {
            return 13 * 60 + flyerNumber * 5;
        }
    }
    else if (source == "C37") {
        if (destination == "lyft") {
            return 19 * 60 + flyerNumber * 5;
        }
        else if (destination == "baggage") {
            return 8 * 60 + flyerNumber * 5;
        }
    }else if (source == "E8") {
        if (destination == "lyft") {
            return 26 * 60 + flyerNumber * 5;
        }
        else if (destination == "baggage") {
            return 15 * 60 + flyerNumber * 5;
        }
    }
    else if (source == "baggage") {
        if (destination == "lyft") {
            return 11 * 60;
        }
    }
    // catch-all, for now
    return 30 * 60;
};

const calculateBaggageTime = (flightNumber, flyersWithBaggage) => {
    // if data exists, get expected time for first baggage to come out
    // based on flightNumber. But since it doesn't exist, we hand-wave
    return 15 * 60 + 10 * flyersWithBaggage;
}

const add_customers_for_lyftoff = (flight) => {
    flyerNumber = 0; // deplaning has about 10 min variance
    flyersWithBaggage = 0; // baggage has about 10 min variance
    flight.flyerList.forEach((flyer) => {
        let timeToLyftPickup;
        if (flyer.hasBaggage) {
            let walkingTime = calculateTime(flight.arrivalGate, "baggage", flyerNumber);
            walkingTime = flyer.needAssistance ? 1.5 * walkingTime : walkingTime;
            let baggageTime = calculateBaggageTime(flight, flyersWithBaggage);
            timeToLyftPickup = walkingTime > baggageTime ? walkingTime : baggageTime;
            timeToLyftPickup += flyer.needAssistance ? 1.5 * calculateTime("baggage", "lyft", flyerNumber) : calculateTime("baggage", "lyft", flyerNumber);
            flyersWithBaggage += 1;
        }
        else {
            timeToLyftPickup = flyer.needAssistance ? 1.5 * calculateTime(flight.arrivalGate, "lyft", flyerNumber) : calculateTime(flight.arrivalGate, "lyft", flyerNumber);
        }
        flyerNumber += 1
        // adjust if flyer needs assistance
        flyer.pickupTime = timeToLyftPickup + flight.arrivalTime;
        // only if they prefer lyft
        if (flyer.lyftPreference != -1) {
            _flyerHeap.push(flyer);
            if (flyer.flightNumber == 1560) {
                flightOneWaiting += 1;
            }
            else if (flyer.flightNumber == 1159) {
                flightTwoWaiting += 1;
            }
            else if (flyer.flightNumber == 906) {
                flightThreeWaiting += 1;
            }
        };
        return;
    });
};


const dispatchLyft = (lyftModule, timeData) => {
    let topFlyer = _flyerHeap.top();
    while(topFlyer != null && topFlyer.pickupTime <= currentTime + timeData["eta_estimates"][topFlyer["lyftPreference"]]["eta_seconds"]) {
        // call Lyft here, but don't do it actually
        let flyer = _flyerHeap.pop();
        if (isDelayed(probabilityDelayed)) {
            flyer.pickupTime += timeToAddWhenDelayed;
            _flyerHeap.push(flyer);
        }
        else {
            if (flyer.flightNumber == 1560) {
                flightOneWaiting -= 1;
            }
            else if (flyer.flightNumber == 1159) {
                flightTwoWaiting -= 1;
            }
            else if (flyer.flightNumber == 906) {
                flightThreeWaiting -= 1;
            }
        }
        // add lyft if haven't added yet
        if (!(_flyerLyftDispatchedSet.has(flyer.id))) {
            _lyftHeaps[flyer.lyftPreference].push({"id": lyftID, "type": flyer.lyftPreference, "pickupTime": topFlyer.pickupTime, "pairID": flyer.id});
            _flyerLyftDispatchedHeaps[flyer.lyftPreference].push(flyer);
            _flyerLyftDispatchedSet.add(flyer.id);
        }
        topFlyer = _flyerHeap.top();
    };  
}

function LyftModuleAtlSouth () {
    const authUrl = "https://PTrHcv-XC2ig:6XoNimObmCUP2PYdH9kA6cF_0uBU0znV@api.lyft.com/oauth/token";    
    const authData = {
        "grant_type": "client_credentials",
        "scope": "public"
    };
    var accessToken;
    console.log("requesting...");
    request.post({url:authUrl, formData:authData}, function(err, response, body) {
        if (err) {
            console.error("On line 246");
            return console.error("Fail:", err);
        }
        var response = JSON.parse(body);
        accessToken = response["access_token"];
        let defaultClient = Lyft.ApiClient.instance;
        
        // Configure OAuth2 access token for authorization: Client Authentication
        let clientAuth = defaultClient.authentications['Client Authentication'];
        clientAuth.accessToken = accessToken;
        console.log("done requesting...");
        let lyftModule = new Lyft.PublicApi();
        lyftModule.getETA(33.6384945, -84.4471744).then((timeData) => {
            mainloop(lyftModule, timeData);
        }, (error) => {
            console.error("On line 228");
            console.error(error);
            return null;
        });
    });
};

var lyftTooSlowCounter = 0;
var flyerTooSlowCounter = 0;
const lyftDelayProbability = 0.1;
const lyftDelayAmount = 2 * 60; 
const flyerWalkDelayProbability = 0.1;
const flyerDelayAmount = 2 * 60;
// part 2: keep track of the lyft
const matchLyftAndDriver = () => {
    _lyftHeaps.forEach((_lyftHeap, index) => {
        let closestLyft = _lyftHeap.top();
        while (closestLyft != null && closestLyft.pickupTime <= currentTime + pairingTimeThreshold) {
            // difference within a minute
            if (isDelayed(lyftDelayProbability)) {
                let lateLyft = _lyftHeap.pop();
                lateLyft.pickupTime += lyftDelayAmount;
                _lyftHeap.push(lateLyft);
                continue;
            }
            if (_flyerLyftDispatchedHeaps[index].top().pickupTime <= closestLyft.pickupTime + 1 * 60) {
                // partnered up
                _flyerLyftDispatchedHeaps[index].pop();
                _lyftHeap.pop();
            }
            else {
                flyerTooSlowCounter += 1;
                break;
            }
            closestLyft = _lyftHeap.top();
        }
    });
    _flyerLyftDispatchedHeaps.forEach((_flyerLyftDispatchedHeap, index) => {
        let closestFlyer = _flyerLyftDispatchedHeap.top();
        if (closestFlyer != null && _lyftHeaps[index].top().pickupTime > closestFlyer.pickupTime + 2 * 60) {
            lyftTooSlowCounter += 1;
        }
    });
}


// this function gets called every 10 seconds or so
const mainloop = (lyftModule, timeData) => {
    let topFlight = _flightHeap.top();
    while(topFlight != null && topFlight.arrivalTime < currentTime) {
        add_customers_for_lyftoff(_flightHeap.pop())
        topFlight = _flightHeap.top();
    }
    dispatchLyft(lyftModule, timeData);
    matchLyftAndDriver();
    console.log(currentTime, _flyerHeap.len, flyerTooSlowCounter, lyftTooSlowCounter, flightOneWaiting, flightTwoWaiting, flightThreeWaiting, _lyftHeaps[1].len + _lyftHeaps[2].len, _flyerLyftDispatchedHeaps[1].len + _flyerLyftDispatchedHeaps[2].len);
    setTimeout(() => {
        currentTime += timeInterval;
        if (currentTime > demoBaseTime + 100*60) return;
        mainloop(lyftModule, timeData);}, 1000);
}

const main = () => {
    flights.forEach((flight) => {
        _flightHeap.push(flight);
        return;
    })
    LyftModuleAtlSouth();
}

main();