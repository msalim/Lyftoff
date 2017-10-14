# time_to_leave_algorithm.py
# Assumptions: limited to ATL, rideshare (not bus, not own car) transportation
#              further assume we have correct data on baggage queue lines
#
# We conclude the following to be our pre-flight model:
# 1. Start from starting point, default to home
# 2. Flyer rides Lyft to airport (restricted to rideshare transport)
# 3. Flyer may need to check-in and drop luggage (may need additional sensors)
#    and walk to security checkpoint (includes unloading luggages)
# 4. Flyer goes through security (TSA) --> may be longer and longer over time
#    as # passenger increases (add to our learning model)
# 5. Flyer proceeds to terminal (treat with maximum expected value, e.g. if
#    train just left)
# 6. Flyer proceeds to gate
# 7. Optionally, flyer may decide to roam around the airport (e.g. to shop)
# 8. Add 5-15 minutes for restroom break and "in case if late"
#
# Our algorithm estimates (very well) the time the user should leave from
# the source location to get to the airport in time. Of course, there's no
# guarantee that the algorithm will work appropriately since all values
# are estimates (mostly the TSA wait time and check-in wait time, since these
# will at best be based on historical data and past performance does not
# guarantee future results), but it should give a good estimate nevertheless
# since Google maps is quite reliable and the other time calculations are
# essentially constants.
#
# Our algorithm starts by determining the boarding time.
# It then calculates the time T, when the flyer needs to have gone through the
# security checkpoint in order to have enough time for proceeding to terminal
# + proceeding to gate + spend desired amount of additional time at the
# airport by boarding time.
# It then calculates the time U, when the flyer needs to have checked in and
# dropped baggages in order to have enough time to pass through
# security checkpoint by time T.
# It then calculates V, when the flyer needs to have arrived at the airport
# in order to have checked in and dropped baggage by time U.
# It then calculates time W, when the flyer needs to leave home in order to
# arrive at the airport by time W.
#
# Inputs:
# - Essentially flyer details:
#   - Flight number, day in week and boarding time
#   - Flight terminal and gate (else assume worst)
#   - Whether passenger has checked in
#   - Whether passenger has baggage to be checked in
#   - Whether passenger needs additional help moving in the airport
#     (indicated by whether they need additional assistance to board)
# - Flyer's desired additional time to spend at airport (e.g. for shopping)
# - Flyer's "home" / source address, which may be variable
#
#
# The algorithm proceeds as follows:
# - Retrieve boarding time of the flight.
# - Calculate time required X to proceed from security checkpoint to terminal,
#   from terminal to gate, and additional time desired at airport. Add these
#   together.
# - Calculate T, which is boarding_time - X.
# - To calculate U, find in the TSA historical data (for that day) the closest
#   time U to T such that U + wait_time + stdev(wait_time) = T. We won't have
#   stdev data due to no available data, but it'll work if we gather
#   extensive data. 
# - To calculate V, find in the Delta historical data (for that day) the
#   closest time V to U such that V + check_in + drop_bag_time + 
#   stdev(check_in) + stdev(drop_bag_time) = U. check_in and drop_bag_time are
#   dependent on whether the passenger needs to drop baggages.
# - To calculate W, query Google Maps data for W, the required time to leave
#   from origin address on that day and time such that W + travel_time (+
#   stdev(travel_time), if exists) = U.
# - May need to increase time due to additional moving help.
# - Return W - ~5-15 minutes (toilet / safety), the required time to leave.
# Or assume that boarding time is a safe "gap time", so passengers can
# arrive 20 minutes late and still make it to boarding--in which case
# return W without modification.