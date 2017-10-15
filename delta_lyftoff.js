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

var Minheap = require("minheap");

const compareFn = (flyer1, flyer2) => {
    return y-x;
}

const _flyerHeap = new(Minheap);

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
 *   pickupTime : number
 *   }
 */

// returns a number that calculates gate to terminal
const calculateTime = (source, destination) => {
    return 10;
};

const calculateBaggageTime = (flightNumber, flyersWithBaggage) => {
    // if data exists, get expected time for first baggage to come out
    // based on flightNumber. But since it doesn't exist, we hand-wave
    return 10 + 0.1 * flyersWithBaggage;
}

const add_customers_for_lyftoff = (flight) => {
    flyersWithBaggage = 0;
    flight.flyerList.forEach((flyer) => {
        let timeToLyftPickup;
        if (flyer.hasBaggage) {
            timeToLyftPickup = max([calculateTime(flight.arrivalGate, "baggage"),
                            calculateBaggageTime(flightNumber, flyersWithBaggage)]) +
                            calculateTime("baggage", "lyft");
            flyersWithBaggage += 1;
        }
        else {
            timeToLyftPickup = calculateTime(flight.arrivalGate, "lyft");    
        }
        // adjust if flyer needs assistance
        timeToLyftPickup = flyer.needAssistance ? 1.5 * timeToLyftPickup : timeToLyftPickup;
        flyer.pickupTime = timeToLyftPickup;
        _flyerHeap.push(flyer);
        return;
    });
};

// this function gets called every 10 seconds or so
const popAndDispatchLyft = (lyftModule) => {
    const date = new Date();
    const time = date.getTime()/1000; // in seconds
    const lyftTimeRequired = lyftModule.getEstimateWaitTime("ATL-SOUTH");
    let topFlyer = _flyerHeap.top();
    while(topFlyer != null && topFlyer < time)
    {
        lyftModule.dispatch(_flyerHeap.pop());
        topFlyer = _flyerHeap.top();
    };
    return;
}

import lyft from 'node-lyft';
const LyftModuleAtlSouth = (accessToken) => {
    let defaultClient = lyft.ApiClient.instance;
    
    // Configure OAuth2 access token for authorization: Client Authentication
    let clientAuth = defaultClient.authentications['Client Authentication'];
    clientAuth.accessToken = accessToken;
    
    let apiInstance = new lyft.PublicApi();
    
    apiInstance.getETA(33.6384945, -84.4471744).then((data) => {
      console.log('API called successfully. Returned data: ' + data);
    }, (error) => {
      console.error(error);
    });    
};


const poller = () => {
    const lyftModuleAtlSouth = new LyftModule("PTrHcv-XC2ig");
    while(true) {
        popAndDispatchLyft(lyftModule);
        sl
    }
}