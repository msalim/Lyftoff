from tkinter import *
import json
import random

travelersPickedUp = 0
lyftsGone = 0

def delete_then_jump(root, canvas, index, flyer_data_json, lyft_data_json, button):
    button.pack_forget()
    draw_stuff(root, canvas, index, flyer_data_json, lyft_data_json)

def main():
    with open("arr_flyer.txt", "rU") as flyer_file:
        with open("arr_lyft.txt", "rU") as lyft_file:
            flyer_data_json = json.loads(flyer_file.read())
            lyft_data_json = json.loads(lyft_file.read())
            
    root = Tk()
    canvas = Canvas(root, width=1000, height=550)
    canvas.pack()
    button = Button(root, text="Click to start simulation", 
        command = lambda: delete_then_jump(root, canvas, 0, flyer_data_json, lyft_data_json, button))
    button.pack()
    root.mainloop()
    # 6:30pm to 8:30pm
    
    return

flyer_nodes = dict() # starts at 100, 100, ends at 480, 500
lyft_nodes = dict() # starts at 900, 100, ends at 520, 500

def redraw_lyft_node(canvas, time, lyft_node):
    global flyer_nodes
    global travelersPickedUp
    global lyftsGone
    if time > lyft_node["pickupTime"]:
        if "pickedUp" not in lyft_node and travelersPickedUp > lyftsGone:
            lyft_node["pickedUp"] = True
            lyftsGone += 1
            return
    if "pickedUp" in lyft_node: return
    centerX = int(-(380 * (time-lyft_node["startTime"]) / (lyft_node["pickupTime"]-lyft_node["startTime"])) + 900)
    centerY = int((400 * (time-lyft_node["startTime"]) / (lyft_node["pickupTime"]-lyft_node["startTime"])) + 100)
    shift = random.randint(-5, 5)
    x0 = centerX-5+shift
    y0 = centerY-5+shift
    x1 = centerX+5+shift
    y1 = centerY+5+shift
    if (lyft_node["isPassengerLate"]):
        flyer_node = flyer_nodes[lyft_node["pairID"]]
        if time > lyft_node["pickupTime"]:
            
            canvas.create_oval(515+shift, 495+shift, 525+shift, 505+shift, fill="purple")
            flyerCenterX = int(((time-flyer_node["startTime"]) / (flyer_node["pickupTime"]-flyer_node["startTime"])) * 380 + 100)
            flyerCenterY = int(((time-flyer_node["startTime"]) / (flyer_node["pickupTime"]-flyer_node["startTime"])) * 400 + 100)
            # then create line :)
            canvas.create_line(520+shift, 500+shift, flyerCenterX+shift, flyerCenterY-15+shift, fill="red")
        else:
            canvas.create_oval(x0, y0-15, x1, y1-15, fill="purple")
            flyerCenterX = int(((time-flyer_node["startTime"]) / (flyer_node["pickupTime"]-flyer_node["startTime"])) * 380 + 100)
            flyerCenterY = int(((time-flyer_node["startTime"]) / (flyer_node["pickupTime"]-flyer_node["startTime"])) * 400 + 100)
            # then create line :)
            canvas.create_line(centerX, centerY-15, flyerCenterX+shift, flyerCenterY-15+shift, fill="red")
    else:
        if time > lyft_node["pickupTime"]:
            canvas.create_oval(515+shift, 495+shift, 525+shift, 505+shift, fill="lightgreen")
        else:
            canvas.create_oval(x0, y0, x1, y1, fill="lightgreen")
    

def redraw_flyer_node(canvas, time, flyer_node):
    global travelersPickedUp
    if time > flyer_node["pickupTime"]:
        if "pickedUp" not in flyer_node:
            flyer_node["pickedUp"] = True
            travelersPickedUp += 1
        return
    centerX = int(((time-flyer_node["startTime"]) / (flyer_node["pickupTime"]-flyer_node["startTime"])) * 380 + 100)
    centerY = int(((time-flyer_node["startTime"]) / (flyer_node["pickupTime"]-flyer_node["startTime"])) * 400 + 100)
    shift = random.randint(-5, 5)
    x0 = centerX-5+shift
    y0 = centerY-5+shift
    x1 = centerX+5+shift
    y1 = centerY+5+shift
    if (flyer_node["isLate"]):
        canvas.create_oval(x0, y0-15, x1, y1-15, fill="red")
    else:
        canvas.create_oval(x0, y0, x1, y1, fill="green")

late_flyers = set()

def draw_stuff(root, canvas, index, flyer_data_json, lyft_data_json):
    global late_flyers
    global flyer_nodes
    global lyft_nodes
    if index >= len(flyer_data_json): return
    time = 1110
    canvas.delete(ALL)
    canvas.create_text(925, 530, text="%d:%.2d" % ((time+(index))//60, (time+(index))%60), font="Roboto 24")
    canvas.create_text(100, 70, text="")
    canvas.create_oval(85, 85, 115, 115, fill="yellow")
    canvas.create_oval(885, 85, 915, 115, fill="magenta")
    root.after(500, draw_stuff, root, canvas, index+1, flyer_data_json, lyft_data_json)
    nodes = len(flyer_data_json)
    for flyer in flyer_data_json[index]:
        if flyer["id"] not in flyer_nodes:
            flyer_nodes[flyer["id"]] = dict()
            flyer_nodes[flyer["id"]]["startTime"] = time+index
            flyer_nodes[flyer["id"]]["pickupTime"] = flyer["pickupTime"]//60
            flyer_nodes[flyer["id"]]["isLate"] = False
        if flyer_nodes[flyer["id"]]["pickupTime"] != flyer["pickupTime"]//60:
            flyer_nodes[flyer["id"]]["isLate"] = True
            late_flyers.add(flyer["id"])
            flyer_nodes[flyer["id"]]["pickupTime"] = flyer["pickupTime"]//60
        redraw_flyer_node(canvas, time+index, flyer_nodes[flyer["id"]])
    for lyft in lyft_data_json[index]:
        if lyft["id"] not in lyft_nodes:
            lyft_nodes[lyft["id"]] = dict()
            lyft_nodes[lyft["id"]]["startTime"] = time+index
            lyft_nodes[lyft["id"]]["pickupTime"] = lyft["pickupTime"]//60
            lyft_nodes[lyft["id"]]["isPassengerLate"] = False
            lyft_nodes[lyft["id"]]["pairID"] = lyft["pairID"]
        if lyft_nodes[lyft["id"]]["pairID"] in late_flyers:
            lyft_nodes[lyft["id"]]["isPassengerLate"] = True
        redraw_lyft_node(canvas, time+index, lyft_nodes[lyft["id"]])


main()