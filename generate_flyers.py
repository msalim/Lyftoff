# generate_flyers.py
# generate flyers randomly
# 
# flyer : objectOf {
# *   id : number,
# *   flightNumber : number,
# *   hasBaggage : boolean,
# *   needAssistance : boolean,
# *   extraTime : number,
# *   lyftPreference: number, // 0 = line, 1 = lyft, 2 = plus, 3 = premier, 4 = lux, 5 = luxsuv
# *   pickupTime : number,
# *   isAtPickup: boolean
# *   }

import random
import json

id = 0

def coinflip(pSuccess):
    res = random.randint(0, 100)
    return (res < pSuccess)

def generateFlyer(numFlyers, flightNumber, pBaggage, pNeedAssistance):
    global id
    flyerList = []
    for i in range(numFlyers):
        flyer = dict()
        flyer["id"] = id
        flyer["flightNumber"] = flightNumber
        flyer["hasBaggage"] = coinflip(pBaggage)
        flyer["needAssistance"] = coinflip(pNeedAssistance)
        flyer["lyftPreference"] = 1 if coinflip(50) else (2 if coinflip(30) else -1)
        id += 1
        flyerList.append(flyer)
    print(json.dumps(flyerList))
    print("")
    return json.dumps(flyerList, indent=4)


# 149 for flights 1560 and 1159 (MD88)
# 180 for flight 906 (757)
generateFlyer(149, 1560, 35, 5) #md88
generateFlyer(149, 1159, 30, 2) #md88
generateFlyer(180, 906, 50, 3) #757-200
generateFlyer(182, 2393, 25, 3) #321
generateFlyer(180, 2299, 33, 2) #737-900
generateFlyer(110, 74, 61, 2) #717-200
generateFlyer(180, 2623, 32, 3) #737-900
generateFlyer(149, 1241, 38, 3) #md88
generateFlyer(180, 1814, 31, 2) #737-900
generateFlyer(149, 1862, 28, 4) #md88
