// Copyright 2016-present, Oculus VR, LLC.
// All rights reserved.
//
// This source code is licensed under the license found in the
// LICENSE-examples file in the root directory of this source tree.
(function (exports, navigator) {
  // GamepadState uses navigator.getGamepads to maintain the combined button and axis state of all gamepads.
  // It also translates Gear VR specific buttons into semantic events for tapping and swiping.
  var GamepadState = function () {
      this.pressedButtons = {};  // The pressed state of the buttons exposed by any active gamepad
      this.oldPressedButtons = {};  // The previous pressed state of the buttons exposed by any active gamepad
      this.gearVRButtons = {};   // The pressed state of the buttons for the Gear VR device specifically
      this.axes = {};            // The values of the axes exposed by any active gamepad
      this.gearVRAxes = {};      // The values of the axes for the Gear VR device specifically
      this.oldGearVRAxes = {};
      this.ongearvrinput = null; // A callback that is called when Gear VR button events are detected, as they would appear in the Carmel browser
  };

  // This should be called once per frame.
  GamepadState.prototype.update = function () {
    var self = this;

    // Check all gamepads every frame, and record button and axis information
    Array.prototype.forEach.call(navigator.getGamepads(), function (activePad, padIndex) {
      if (activePad && activePad.connected) {

        var isGearVRDevice = activePad.id.includes("Gear VR");

        // Update pressedButtons which is combined state for all gamepads
        activePad.buttons.forEach(function (gamepadButton, buttonIndex) {
          self.oldPressedButtons[buttonIndex] = self.pressedButtons[buttonIndex];
          self.pressedButtons[buttonIndex] = gamepadButton.pressed;

          // If this is the Gear VR device then track those buttons separately as well
          if (isGearVRDevice) {
            self.gearVRButtons[buttonIndex] = gamepadButton.pressed;
          }
        });

        // Update axes which is combined state for all gamepads
        self.axes = {};

        if (isGearVRDevice) {
          self.oldGearVRAxes = self.gearVRAxes;
          self.gearVRAxes = {};
        }

        activePad.axes.forEach(function (axisValue, axisIndex) {
          self.axes[axisIndex] = axisValue;

          // If this is the Gear VR device then track those axes separately as well
          if (isGearVRDevice) {
            self.gearVRAxes[axisIndex] = axisValue;
          }
        });
      }
    });

    // Raise Gear VR input events based on the state of the gamepad
    if (!this.oldPressedButtons[0] && this.gearVRButtons[0]) {
      this._onGearVRInput("tap");
    }
    if (!this.oldGearVRAxes[0] && this.gearVRAxes[0] < 0) {
      this._onGearVRInput("right");
    }
    if (!this.oldGearVRAxes[0] && this.gearVRAxes[0] > 0) {
      this._onGearVRInput("left");
    }
    if (!this.oldGearVRAxes[1] && this.gearVRAxes[1] < 0) {
      this._onGearVRInput("up");
    }
    if (!this.oldGearVRAxes[1] && this.gearVRAxes[1] > 0) {
      this._onGearVRInput("down");
    }
  };

  GamepadState.prototype._onGearVRInput = function (direction) {
    if (this.ongearvrinput) {
      this.ongearvrinput(direction);
    }
  };

  exports.GamepadState = GamepadState;
})(window, window.navigator);