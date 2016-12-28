// Copyright 2016-present, Oculus VR, LLC.
// All rights reserved.
//
// This source code is licensed under the license found in the
// LICENSE-examples file in the root directory of this source tree.
(function (exports) {
  var WebVRPrograms = {
    createTextureProgram: function (webVRCommon) {
      var quadVS = [
        "uniform mat4 projectionMat;",
        "uniform mat4 viewMat;",
        "uniform mat4 modelMat;",
        "attribute vec3 position;",
        "attribute vec2 texCoord;",
        "varying vec2 vTexCoord;",

        "void main() {",
        "  vTexCoord = texCoord;",
        "  gl_Position = projectionMat * viewMat * modelMat * vec4(position, 1.0);",
        "}",
      ].join("\n");

      var quadFS = [
        "precision mediump float;",
        "uniform sampler2D diffuse;",
        "varying vec2 vTexCoord;",

        "void main() {",
        "  gl_FragColor = texture2D(diffuse, vTexCoord);",
        "}",
      ].join("\n");
      return webVRCommon.loadProgram(quadVS, quadFS);
    }
  };

  exports.WebVRPrograms = WebVRPrograms;
})(window);