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

const Lyft = require("node-lyft");
const Minheap = require("minheap");
const request = require("request");

const pollFrequency = 10; // seconds per poll
const lyftAPIToken = "mD6RQO8YOCVEtO3yt8L6PJsO0o9u2WWHNEoAotlvoNlt9OBJyY/jn/o25etTq/SXw0hwcdAYLB0eLlTOKYVfjDNiQ6IpSenMsU7LdOtiC5y9UUyNvUKoqUM=";

const compareFn = (flyer1, flyer2) => {
    return flyer1.pickupTime-flyer2.pickupTime;
}

const _flyerHeap = new Minheap(compareFn);

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
 */

// returns a number that calculates gate to terminal
const calculateTime = (source, destination) => {
    if (source == "D31") {
        if (destination == "lyft") {
            return 24 * 60;
        }
        else if (destination == "baggage") {
            return 13 * 60;
        }
    }
    else if (source == "D16") {
        if (destination == "lyft") {
            return 19 * 60;
        }
        else if (destination == "baggage") {
            return 8 * 60;
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
const popAndDispatchLyft = () => {
    new LyftModuleAtlSouth();
    setTimeout(() => {popAndDispatchLyft();}, 5000);
}

const tryLoopAndPop = (lyftModule) => {
    const date = new Date();
    const time = date.getTime()/1000; // in seconds
    lyftModule.getETA(33.6384945, -84.4471744).then((timeData) => {
        let topFlyer = _flyerHeap.top();
        while(topFlyer != null && topFlyer.pickupTime < time + timeData["eta_estimates"][topFlyer["lyftPreference"]]["eta_seconds"])
        {
            // call Lyft here, but don't do it actually
            _flyerHeap.pop();
            console.log("Popped a flyer to be picked up...");
            topFlyer = _flyerHeap.top();
        };
      }, (error) => {
        console.error(error);
        return null;
      });  
}

function LyftModuleAtlSouth () {
    const authUrl = "https://PTrHcv-XC2ig:6XoNimObmCUP2PYdH9kA6cF_0uBU0znV@api.lyft.com/oauth/token";    
    const authData = {
        "grant_type": "client_credentials",
        "scope": "public"
    };
    var accessToken;
    request.post({url:authUrl, formData:authData}, function(err, response, body) {
        if (err) {
            return console.error("Fail:", err);
        }
        var response = JSON.parse(body);
        accessToken = response["access_token"];
        let defaultClient = Lyft.ApiClient.instance;
        
        // Configure OAuth2 access token for authorization: Client Authentication
        let clientAuth = defaultClient.authentications['Client Authentication'];
        clientAuth.accessToken = accessToken;
        console.log(accessToken);
        
        let apiInstance = new Lyft.PublicApi();
        tryLoopAndPop(apiInstance);
    });
};


const poller = () => {
    const date = new Date();
    const time = date.getTime()/1000; // in seconds

    _flyerHeap.push({"pickupTime": time, "lyftPreference": 1});
    _flyerHeap.push({"pickupTime": time+70, "lyftPreference": 1});
    _flyerHeap.push({"pickupTime": time+130, "lyftPreference": 1});
    _flyerHeap.push({"pickupTime": time+190, "lyftPreference": 1});
    _flyerHeap.push({"pickupTime": time+250, "lyftPreference": 1});
    _flyerHeap.push({"pickupTime": time+310, "lyftPreference": 1});
    _flyerHeap.push({"pickupTime": time+370, "lyftPreference": 1});
    _flyerHeap.push({"pickupTime": time+430, "lyftPreference": 1});
    _flyerHeap.push({"pickupTime": time+490, "lyftPreference": 1});
    _flyerHeap.push({"pickupTime": time+550, "lyftPreference": 1});
    _flyerHeap.push({"pickupTime": time+610, "lyftPreference": 1});

    popAndDispatchLyft();
}

poller();