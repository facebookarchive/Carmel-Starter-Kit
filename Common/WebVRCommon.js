// Copyright 2016-present, Oculus VR, LLC.
// All rights reserved.
//
// This source code is licensed under the license found in the
// LICENSE-examples file in the root directory of this source tree.
(function (exports) {
  var powerOf2 = function (x) { return ((x !== 0) && !(x & (x - 1))); }
  //  WebVRCommmon provides a simplified API to WebGL, reducing boilerplate.
  //
  //  init can optionally be an object with the following properties
  //  clearDepth <boolean> true if the depth should be cleared
  //  clearColor <object> an object with r,g,b,a attributes in the 0 - 1 range
  //  fallbackToMono <boolean> true if mono rendering is supported when VRDevice is not found.
  //  monoFOV <number> the field of view (in degrees) for the mono camera.
  //  monoNear <number> the depth of the near clipping plane for the mono camera.
  //  monoFar <number> the depth of the far clipping plane for the mono camera.
  //  monoCameraYaw <number> the initial yaw of the mono camera.
  //  monoCameraPitch <number> the initial pitch of the mono camera.
  //  layerSource <Canvas> the canvas that will provide vr layerSource
  //  layerSourceId <string> the id of the element that will provide a layerSource
  //  messageElement <Element> the dom element to put error messages in
  //  messageElementId <string> the id of the dom element to put messages in
  //  gl <WebGLRenderingContext> the rendering context to use for drawing, if not specified a  context will be created from the layerSource
  //  inspector <object> an initialization object that will be used to construct a WebVRInspector
  var WebVRCommon = function (init) {
    // clear color and depth by default
    this.clearDepth = init.clearDepth || true;
    this.clearColor = init.clearColor || { r: 0, g: 0, b: 0, a: 1 };

    // mono fallback
    this.fallbackToMono = init.fallbackToMono || true;
    this.monoFOV = (init.monoFOV || 90) * Math.PI / 180;
    this.monoNear = (init.monoNear || 0.01);
    this.monoFar = (init.monoFar || 10000);

    // setup a projection for mono
    this.monoProjectionMatrix = mat4.create();
    mat4.perspective(this.monoProjectionMatrix, 1, this.monoFOV, this.monoNear, this.monoFar);

    // setup a view for mono
    this.monoCameraYaw = init.monoCameraYaw || 0;
    this.monoCameraPitch = init.monoCameraPitch || 0;
    this.yawAxis = [0, 1, 0];
    this.pitchAxis = [1, 0, 0];
    this.monoCameraRotationYaw = quat.create();
    this.monoCameraRotationPitch = quat.create();
    this.monoCameraRotation = quat.create();
    this.monoViewMatrix = mat4.create();
    this.inputDragging = false;
    this.inputLastX = 0;
    this.inputLastY = 0;
    this.inputScale = 0.001;
    this._initMonoCameraInput();

    this.hasWebVRSupport = !!navigator.getVRDisplays;
    this.layerSource = init.layerSource || document.getElementById(init.layerSourceId);
    this.messageElement = init.messageElement || document.getElementById(init.messageElementId);
    this.gl = init.gl || this._initWebGL();
    if (typeof WebVRShim === 'function') {
        this.shim = new WebVRShim(this.gl);
    }
    if (typeof WebVRInspector === 'function') {
      // Create an inspector and replace the frame loop with the inspector version
      this.inspector = new WebVRInspector(init.inspector);
      this._onAnimationFrame = this.inspector.createFrame(
        this._preUpdate.bind(this),
        this._update.bind(this),
        this._render.bind(this)
      );
    }
  };

  WebVRCommon.prototype._initMonoCameraInput = function () {
    var self = this;
    var startDrag = function (target, x, y) {
      if (target === self.layerSource) {
        self.inputDragging = true;
        self.inputLastX = x;
        self.inputLastY = y;
        return true;
      }
    };

    var moveDrag = function (x, y) {
      if (self.inputDragging) {
        var deltaX = (x - self.inputLastX) * self.inputScale;
        var deltaY = (y - self.inputLastY) * self.inputScale;

        self.monoCameraYaw += Math.PI * deltaX;
        self.monoCameraPitch += Math.PI * deltaY;

        // Limit/normalized the camera angles
        while (self.monoCameraYaw < -Math.PI) self.monoCameraYaw += Math.PI * 2;
        while (self.monoCameraYaw >  Math.PI) self.monoCameraYaw -= Math.PI * 2;
        self.monoCameraPitch = Math.max(-Math.PI / 2.001, Math.min(self.monoCameraPitch, Math.PI / 2.001));

        self.inputLastX = x;
        self.inputLastY = y;
      }
    };

    var endDrag = function () {
      self.inputDragging = false;
    };

    document.body.addEventListener("touchstart", function (event) {
      if (startDrag(event.target, event.changedTouches[0].clientX, event.changedTouches[0].clientY)) {
        event.preventDefault();
      }
    }, false);
    document.body.addEventListener("touchmove", function (event) {
      moveDrag(event.changedTouches[0].clientX, event.changedTouches[0].clientY);
    }, false);
    document.body.addEventListener("touchend", function (event) {
      endDrag();
    }, false);
    document.body.addEventListener("touchend", function (event) {
      endDrag();
    }, false);
    document.body.addEventListener("mousedown", function (event) {
      if (startDrag(event.target, event.clientX, event.clientY)) {
        event.preventDefault();
      }
    }, false);
    document.body.addEventListener("mousemove", function (event) {
      moveDrag(event.clientX, event.clientY);
    }, false);
    document.body.addEventListener("mouseup", function (event) {
      endDrag();
    }, false);
  };

  WebVRCommon.prototype._initWebGL = function () {
    var glAttribs = {
      alpha: false,                   // The canvas will not contain an alpha channel
      antialias: true,                // We want the canvas to perform anti-aliasing
      preserveDrawingBuffer: false    // We don't want our drawing to be retained between frames, we will fully rerender each frame.
    };

    return this.layerSource.getContext("webgl", glAttribs) ||
           this.layerSource.getContext("experimental-webgl", glAttribs); // Edge currently requires this
  };

  // Given strings for the vertex and fragment shader, it compiles and links them into a program.
  // Returns a 'programInfo' that combines the program and reflected information about it.
  WebVRCommon.prototype.loadProgram = function (vs, fs) {
    var gl = this.gl;
    var program = gl.createProgram();

    // Compile vertex shader
    var vertShader = this._loadShader(vs, gl.VERTEX_SHADER)
    gl.attachShader(program, vertShader);

    // Compile fragment shader
    var fragShader = this._loadShader(fs, gl.FRAGMENT_SHADER);
    gl.attachShader(program, fragShader);

    // Link the vertex and fragment shader together.
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const error = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error(error);
    }

    return {
      program: program,
      vertexFormat: this.getVertexFormatFromProgram(program),
      uniforms: this.getUniformsFromProgram(program),
    };
  };

  WebVRCommon.prototype._loadShader = function (src, type) {
    var gl = this.gl;
    var shader = gl.createShader(type);
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const error = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(error);
    }
    return shader;
  };

  // Takes in a dictionary of uniform values and sets them on the program.
  WebVRCommon.prototype.setUniforms = function (programInfo, values) {
    var gl = this.gl;
    var uniforms = programInfo.uniforms;
    for (var key in values) {
      uniforms[key].setter(values[key]);
    }
  };

  // Unfortunately some api's such as vertexAttribPointer only understand primitive data types, and not 'complex' types
  // such as FLOAT_VEC3 even though getActiveAttrib will give us these.  This method extracts information about complex types.
  WebVRCommon.prototype.getInfoForType = function (type, arraySize) {
    var gl = this.gl;
    var components = arraySize || 1;
    if (type === gl.BYTE || type === gl.UNSIGNED_BYTE) {
      return { type: type, arraySize: arraySize, byteSize: 1 * components, dataType: type, components: components };
    }
    if (type === gl.SHORT || type === gl.UNSIGNED_SHORT) {
      return { type: type, arraySize: arraySize, byteSize: 2 * components, dataType: type, components: components };
    }
    if (type === gl.INT || type === gl.UNSIGNED_INT || type === gl.FLOAT) {
      return { type: type, arraySize: arraySize, byteSize: 4 * components, dataType: type, components: components };
    }
    if (type === gl.INT_VEC2 || type === gl.INT_VEC3 || type === gl.INT_VEC4) {
      components *= 2 + (type - gl.INT_VEC2);
      return { type: type, arraySize: arraySize, byteSize: 4 * components , dataType: gl.INT, components: components };
    }
    if (type === gl.FLOAT_VEC2 || type === gl.FLOAT_VEC3 || type === gl.FLOAT_VEC4) {
      components *= 2 + (type - gl.FLOAT_VEC2);
      return { type: type, arraySize: arraySize, byteSize: 4 * components , dataType: gl.FLOAT, components: components };
    }
    if (type === gl.BOOL || type === gl.BOOL_VEC2 || type === gl.BOOL_VEC3 || type === gl.BOOL_VEC4) {
      components *= 1 + (type - gl.BOOL);
      return { type: type, arraySize: arraySize, byteSize: 1 * components , dataType: gl.BOOL, components: components };
    }
    if (type === gl.FLOAT_MAT2 || type === gl.FLOAT_MAT3 || type === gl.FLOAT_MAT4) {
      components *= Math.pow(2 + (type - gl.FLOAT_MAT2), 2);
      return { type: type, arraySize: arraySize, byteSize: 4 * components , dataType: gl.FLOAT, components: components };
    }
    if (type === gl.SAMPLER_2D) {
      return { type: type, arraySize: arraySize, byteSize: null , dataType: null, components: components };
    }
    if (type === gl.SAMPLER_CUBE) {
      return { type: type, arraySize: arraySize, byteSize: null , dataType: null, components: components };
    }
  };

  WebVRCommon.prototype._getUniformSetter = function (type, location) {
    var gl = this.gl;
    if (type === gl.FLOAT) {
      return gl.uniform1f.bind(gl, location);
    }
    if (type === gl.FLOAT_VEC2) {
      return gl.uniform2fv.bind(gl, location);
    }
    if (type === gl.FLOAT_VEC3) {
      return gl.uniform3fv.bind(gl, location);
    }
    if (type === gl.FLOAT_VEC4) {
      return gl.uniform4fv.bind(gl, location);
    }

    if (type === gl.SAMPLER_2D || type === gl.SAMPLER_CUBE || type === gl.INT || type === gl.BOOL ||
        type === gl.SHORT || type === gl.BYTE || type === gl.UNSIGNED_BYTE || type === gl.UNSIGNED_SHORT || type === gl.UNSIGNED_INT) {
      return gl.uniform1i.bind(gl, location);
    }
    if (type === gl.INT_VEC2 || type === gl.BOOL_VEC2) {
      return gl.uniform2iv.bind(gl, location);
    }
    if (type === gl.INT_VEC3 || type === gl.BOOL_VEC3) {
      return gl.uniform3iv.bind(gl, location);
    }
    if (type === gl.INT_VEC4 || type === gl.BOOL_VEC4) {
      return gl.uniform4iv.bind(gl, location);
    }

    if (type === gl.FLOAT_MAT2) {
      return gl.uniformMatrix2fv.bind(gl, location, false);
    }
    if (type === gl.FLOAT_MAT3) {
      return gl.uniformMatrix3fv.bind(gl, location, false);
    }
    if (type === gl.FLOAT_MAT4) {
      return gl.uniformMatrix4fv.bind(gl, location, false);
    }

    throw new Error("Unknown uniform type: " + type);
  };

  // Relects on the program to extract vertex attribute information.
  WebVRCommon.prototype.getVertexFormatFromProgram = function (program) {
    var gl = this.gl;
    var activeAttribs = gl.getProgramParameter(program, this.gl.ACTIVE_ATTRIBUTES);
    var vertexFormat = {
      stride: 0,
      attribs: {}
    };
    for (var i = 0; i < activeAttribs; ++i) {
      var attrib = gl.getActiveAttrib(program, i);
      var typeInfo = this.getInfoForType(attrib.type, attrib.size);
      vertexFormat.attribs[attrib.name] = {
        index: i,
        name: attrib.name,
        location: gl.getAttribLocation(program, attrib.name),
        typeInfo: typeInfo,
      };
      vertexFormat.stride += typeInfo.byteSize;
    }

    return vertexFormat;
  };

  // Reflects on the program to extract uniform information.
  WebVRCommon.prototype.getUniformsFromProgram = function (program) {
    var gl = this.gl;
    var activeUniforms = gl.getProgramParameter(program, this.gl.ACTIVE_UNIFORMS);
    var uniforms = {};
    for (var i = 0; i < activeUniforms; ++i) {
      var uniform = gl.getActiveUniform(program, i);
      var location = gl.getUniformLocation(program, uniform.name);
      var typeInfo = this.getInfoForType(uniform.type, uniform.size);
      var setter = this._getUniformSetter(uniform.type, location);
      uniforms[uniform.name] = {
        index: i,
        name: uniform.name,
        location: location,
        typeInfo: typeInfo,
        setter: setter,
      };
    }
    return uniforms;
  };

  WebVRCommon.prototype.loadGeometry = function (config) {
    var self = this;
    var geometryInfo = {
      src: config.src,
      promise: null,
      loaded: false,
      geometry: null,
    };
    geometryInfo.promise = fetch(geometryInfo.src).then(function (response) {
      return response.json().then(function (geometryJson) {
        geometryInfo.geometry = self.createGeometry(geometryJson);
        geometryInfo.loaded = true;
        return geometryInfo.geometry;
      });
    });
    return geometryInfo;
  };

  // Given a vertexArray and a description of the vertex format, this creates a gl buffer and uploads
  // the vertex data.
  WebVRCommon.prototype.createGeometry = function (config) {
    var gl = this.gl;
    var vertices = config.vertices;
    var primitiveType = config.primitiveType || gl.TRIANGLES;
    var indices = config.indices;

    if (!vertices) {
      throw new Error("config.vertices is required.");
    }
    if (!Array.isArray(vertices)) {
      vertices = [vertices];
    }

    if (vertices.length < 1) {
      throw new Error("At least one vertices is required.");
    }

    // create/upload vertex buffers
    var vertexBuffers = [];
    for (var i = 0; i < vertices.length; ++i) {
      vertexBuffers.push(this._createVertexBuffer(vertices[i]));
    }

    // optionally create/upload index buffer
    var indexBuffer, indexType, indexCount
    if (indices) {
      indexType = gl.UNSIGNED_SHORT;
      indexCount = indices.length;
      indexBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);
    }

    // package it all up for later
    return {
      primitiveType: primitiveType,
      vertexBuffers: vertexBuffers,
      vertexCount: vertices[0].array.length / (vertexBuffers[0].format.stride / 4),
      indexBuffer: indexBuffer,
      indexType: indexType,
      indexCount: indexCount,
    };
  };

  WebVRCommon.prototype._createVertexBuffer = function(vertexBufferInfo) {
    var gl = this.gl;
    // create/upload vertex buffer
    var vertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertexBufferInfo.array), gl.STATIC_DRAW);

    return {
      format: this._convertVertexFormat(vertexBufferInfo.format),
      buffer: vertexBuffer,
    };
  };

  // Converts from a shorthand array format to a map format that is used internally
  WebVRCommon.prototype._convertVertexFormat = function (vertexFormatArray) {
    var vertexFormat = {
      stride: 0,
      attribs: {}
    };
    for (var i = 0; i < vertexFormatArray.length; ++i) {
      var shortFormat = vertexFormatArray[i];
      var typeInfo = this.getInfoForType(shortFormat.type, shortFormat.size);
      vertexFormat.attribs[shortFormat.name] = {
        index: i,
        name: shortFormat.name,
        location: vertexFormat.stride, // the offset to this element so far
        typeInfo: typeInfo,
      };
      vertexFormat.stride += typeInfo.byteSize;
    }
    return vertexFormat;
  }

  // Uses the program and enables vertex attribs. Optionally binds indexBuffer.
  WebVRCommon.prototype.useGeometry = function (geometry, programInfo) {
    var gl = this.gl;
    gl.useProgram(programInfo.program);

    // apply vertex buffers
    var vertexBuffers = geometry.vertexBuffers;
    for (var i = 0; i < vertexBuffers.length; ++i) {
      this._enableVertexBuffer(i, programInfo.vertexFormat, vertexBuffers[i]);
    }

    // optionally apply index buffer
    if (geometry.indexBuffer) {
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, geometry.indexBuffer);
    }
  };

  // Helper to bind a vertex buffer and enable the associated attributes
  WebVRCommon.prototype._enableVertexBuffer = function (arrayIndex, programVertexFormat, vertexBuffer) {
    var gl = this.gl;
    var bufferVertexFormat = vertexBuffer.format;
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer.buffer);
    for (var key in bufferVertexFormat.attribs) {
      var bufferAttrib = bufferVertexFormat.attribs[key];
      var programAttrib = programVertexFormat.attribs[key];
      if (programAttrib) {
        gl.enableVertexAttribArray(programAttrib.location);
        gl.vertexAttribPointer(programAttrib.location,
                              bufferAttrib.typeInfo.components,
                              bufferAttrib.typeInfo.dataType,
                              bufferAttrib.normalize || false,
                              bufferVertexFormat.stride,
                              bufferAttrib.location);
      }
    }
  };

  // Draws the given geometry
  WebVRCommon.prototype.drawGeometry = function (geometry) {
    var gl = this.gl;
    if (geometry.indexBuffer) {
      gl.drawElements(geometry.primitiveType, geometry.indexCount, geometry.indexType, 0);
    } else {
      gl.drawArrays(geometry.primitiveType, 0, geometry.vertexCount);
    }
  };

  // Loads an image and uploads it into a texture.
  // Returns a 'textureInfo' that contains a promise that will be fulfilled when the texture is loaded.
  WebVRCommon.prototype.loadTexture2D = function (config) {
    if (!config.src) {
      throw new Error("config.src is required");
    }

    const textureInfo = this._createTexture(config);
    textureInfo.target = this.gl.TEXTURE_2D;
    textureInfo.promise = this._loadTexture2D(config.src, textureInfo);

    return textureInfo;
  };

  // Loads an image and uploads it into a texture.
  // Returns a 'textureInfo' that contains a promise that will be fulfilled when the texture is loaded.
  WebVRCommon.prototype.loadTextureCube = function (config) {
    if (!config.pos_x) {
      throw new Error("config.pos_x is required");
    }

    const textureInfo = this._createTexture(config);
    textureInfo.target = this.gl.TEXTURE_CUBE_MAP;
    textureInfo.promise = this._loadTextureCube(config, textureInfo);

    return textureInfo;
  };


  // Returns a 'textureInfo' that contains a promise that will be fulfilled with a canvas2D attached
  WebVRCommon.prototype.loadCanvasTexture = function (config) {
    const textureInfo = this._createTexture(config);
    textureInfo.canvas = window.document.createElement("canvas");
    textureInfo.canvas.width = config.width;
    textureInfo.canvas.height = config.height;
    textureInfo.target = this.gl.TEXTURE_2D;
    textureInfo.promise = this._loadTextureCanvas(textureInfo);

    return textureInfo;
  };

  WebVRCommon.prototype._createTexture = function (config) {
    var gl = this.gl;
    var texture = gl.createTexture();
    var genMips = config.generateMipmaps === undefined ? true : !!config.generateMipmaps;
    var textureInfo = {
      wrap_s: config.clamp_s || gl.REPEAT,
      wrap_t: config.clamp_t || gl.REPEAT,
      min_filter: config.min_filter || (genMips ? gl.LINEAR_MIPMAP_NEAREST : gl.LINEAR),
      mag_filter: config.mag_filter || gl.LINEAR,
      generateMipmaps: genMips,
      texture: texture,
    };

    return textureInfo;
  };

  WebVRCommon.prototype._loadImage = function (src) {
    var self = this;
    return new Promise(function (fulfill, reject) {
      var image = new Image();

      var load = function () {
        removeHandlers();
        fulfill(image);
      };

      var error = function () {
        removeHandlers();
        reject("failed to load image: " + src);
      };

      var removeHandlers = function () {
        image.removeEventListener('load', load);
        image.removeEventListener('error', error);
      };

      image.addEventListener("load", load, false);
      image.addEventListener("error", error, false);
      image.src = src;
    });
  };

  WebVRCommon.prototype._loadTexture2D = function (src, textureInfo) {
    var self = this;
    return this._loadImage(src).then(function(image) {
      var gl = self.gl;

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, textureInfo.texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);

      textureInfo.loaded = true;
      textureInfo.width = image.naturalWidth;
      textureInfo.height = image.naturalHeight;

      self._completeTextureLoad(textureInfo);

      // To avoid bad aliasing artifacts we will generate mip maps to use when rendering this texture at various distances
      if (textureInfo.generateMipmaps) {
        gl.generateMipmap(gl.TEXTURE_2D);
      }

      return textureInfo.texture;
    });
  };

  WebVRCommon.prototype._loadTextureCube = function (config, textureInfo) {
    var self = this;
    return Promise.all([
      this._loadImage(config.pos_x),
      this._loadImage(config.neg_x),
      this._loadImage(config.pos_y),
      this._loadImage(config.neg_y),
      this._loadImage(config.pos_z),
      this._loadImage(config.neg_z),
    ]).then(function(images) {
      var gl = self.gl;

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_CUBE_MAP, textureInfo.texture);
      gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, images[0]);
      gl.texImage2D(gl.TEXTURE_CUBE_MAP_NEGATIVE_X, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, images[1]);
      gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_Y, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, images[2]);
      gl.texImage2D(gl.TEXTURE_CUBE_MAP_NEGATIVE_Y, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, images[3]);
      gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_Z, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, images[4]);
      gl.texImage2D(gl.TEXTURE_CUBE_MAP_NEGATIVE_Z, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, images[5]);

      textureInfo.loaded = true;
      textureInfo.width = images[0].naturalWidth;
      textureInfo.height = images[0].naturalHeight;

      self._completeTextureLoad(textureInfo);

      // To avoid bad aliasing artifacts we will generate mip maps to use when rendering this texture at various distances
      if (textureInfo.generateMipmaps) {
        gl.generateMipmap(gl.TEXTURE_CUBE_MAP);
      }

      return textureInfo.texture;
    });
  };

   WebVRCommon.prototype._loadTextureCanvas = function (textureInfo) {
    var self = this;
    return new Promise(function (fulfill, reject) {
      textureInfo.loaded = true;
      textureInfo.width = textureInfo.canvas.width;
      textureInfo.height = textureInfo.canvas.height;

      self._completeTextureLoad(textureInfo);

      fulfill(textureInfo.texture);
    });
  };

  WebVRCommon.prototype._completeTextureLoad = function (textureInfo) {
    var gl = this.gl;
    // turn off mips/filtering/wrapping for non-power-of-2 textures
    if (!powerOf2(textureInfo.width) || !powerOf2(textureInfo.height)) {
      textureInfo.wrap_s = gl.CLAMP_TO_EDGE;
      textureInfo.wrap_t = gl.CLAMP_TO_EDGE;
      textureInfo.min_filter = gl.LINEAR;
      textureInfo.mag_filter = gl.LINEAR;
      textureInfo.generateMipmaps = false;
    }
  };

  // Enables a texture and binds it to the given texture unit.
  WebVRCommon.prototype.useTexture = function(textureInfo, textureUnit) {
    var gl = this.gl;
    if (textureInfo.loaded) {
      var target = textureInfo.target;
      gl.activeTexture(gl.TEXTURE0 + textureUnit);
      gl.bindTexture(target, textureInfo.texture);

      gl.texParameteri(target, gl.TEXTURE_WRAP_S, textureInfo.wrap_s);
      gl.texParameteri(target, gl.TEXTURE_WRAP_T, textureInfo.wrap_t);
      gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, textureInfo.min_filter);
      gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, textureInfo.mag_filter);
    }
  };

  // Applications should call this to kick off the render loop.
  WebVRCommon.prototype.start = function () {
    // Get the first VRDisplay that is available and try to requestPresent.
    // If VR is unavailable or we aren't able to present, we will simply display an HTML message in the page.
    var self = this;
    if (self.hasWebVRSupport) {
      navigator.getVRDisplays().then(function (displays) {
        if (displays.length > 0) {
          // We reuse this every frame to avoid generating garbage
          self.frameData = new VRFrameData();

          self.vrDisplay = displays[0];

          // We must adjust the canvas (our VRLayer source) to match the VRDisplay
          var leftEye = self.vrDisplay.getEyeParameters("left");
          var rightEye = self.vrDisplay.getEyeParameters("right");

          // This layer source is a canvas so we will update its width and height based on the eye parameters.
          // For simplicity we will render each eye at the same resolution
          self.layerSource.width = Math.max(leftEye.renderWidth, rightEye.renderWidth) * 2;
          self.layerSource.height = Math.max(leftEye.renderHeight, rightEye.renderHeight);

          // This can normally only be called in response to a user gesture.
          // In Carmel, we can begin presenting the VR scene right away.
          self.vrDisplay.requestPresent([{ source: self.layerSource }]).then(function () {
            // Start our render loop, which is synchronized with the VRDisplay refresh rate
            self.requestAnimationFrame();
          }).catch(function (err) {
            // The Carmel Developer preview allows entry into VR at any time because it is a VR first experience.
            // Other browsers will only allow this to succeed if called in response to user interaction, such as a click or tap though.
            // We expect this to fail outside of Carmel and would present the user with an "Enter VR" button of some sort instead.
            self.addHTMLMessage("Failed to requestPresent.");
          });
        } else {
          // Usually you would want to hook the vrdisplayconnect event and only try to request present then.
          self.addHTMLMessage("There are no VR displays connected.");
        }
      }).catch(function (err) {
        self.addHTMLMessage("VR Displays are not accessible in this context.  Perhaps you are in an iframe without the allowvr attribute specified.");
      });
    } else {
      if (self.fallbackToMono) {
        self.requestAnimationFrame();
      } else {
        self.addHTMLMessage("WebVR is not supported on this browser.");
        self.addHTMLMessage("To support progressive enhancement your fallback code should render a normal Canvas based WebGL experience for the user.");
      }
    }
  };

  // Request another animation frame.  Falls back to the window if vrDisplay isn't available.
  WebVRCommon.prototype.requestAnimationFrame = function () {
    if (!this._onAnimationFrameCallback) {
      this._onAnimationFrameCallback = this._onAnimationFrame.bind(this);
    }
    if (this.vrDisplay) {
      this.vrDisplay.requestAnimationFrame(this._onAnimationFrameCallback);
    } else {
      requestAnimationFrame(this._onAnimationFrameCallback);
    }
  };

  WebVRCommon.prototype._preUpdate = function (timestamp) {
    // Continue to request frames to keep the render loop going
    this.requestAnimationFrame();
    if (this.shim) {
      this.shim.beginFrame();
    }
    if (this.preUpdate) {
      this.preUpdate(timestamp);
    }
  };


  WebVRCommon.prototype._update = function (timestamp) {
    if (this.vrDisplay) {
      // Get the current pose data
      this.vrDisplay.getFrameData(this.frameData);

      if (this.update) {
        this.update(timestamp, this.frameData.leftProjectionMatrix, this.frameData.leftViewMatrix);
      }
    } else if (this.fallbackToMono) {

        quat.setAxisAngle(this.monoCameraRotationYaw, this.yawAxis, this.monoCameraYaw);
        quat.setAxisAngle(this.monoCameraRotationPitch, this.pitchAxis, this.monoCameraPitch);
        quat.multiply(this.monoCameraRotation, this.monoCameraRotationPitch, this.monoCameraRotationYaw);
        mat4.fromQuat(this.monoViewMatrix, this.monoCameraRotation);

        // Ensure canvas size matches element size
        var width = this.layerSource.clientWidth;
        var height = this.layerSource.clientHeight;
        this.layerSource.width = width;
        this.layerSource.height = height;

        mat4.perspective(this.monoProjectionMatrix, this.monoFOV, width / height, this.monoNear, this.monoFar);

        if (this.update) {
          this.update(timestamp, this.monoProjectionMatrix, this.monoViewMatrix);
        }
    }
  };

  WebVRCommon.prototype._render = function () {
    var gl = this.gl;

    // Clear canvas - we do this outside of render to avoid clearing twice
    this._clear();

    if (this.render) {
      if (this.vrDisplay) {
        // Render the left eye
        var layerSource = this.layerSource;
        gl.viewport(0, 0, layerSource.width * 0.5, layerSource.height);
        this.render(this.frameData.leftProjectionMatrix, this.frameData.leftViewMatrix, "left");

        // Render the right eye
        gl.viewport(layerSource.width * 0.5, 0, layerSource.width * 0.5, layerSource.height);
        this.render(this.frameData.rightProjectionMatrix, this.frameData.rightViewMatrix, "right");

        // Submit the newly rendered layer to be presented by the VRDisplay
        this.vrDisplay.submitFrame();
      } else if (this.fallbackToMono) {
        // Render mono
        gl.viewport(0, 0, this.gl.canvas.width, this.gl.canvas.height);
        this.render(this.monoProjectionMatrix, this.monoViewMatrix, "mono");
      }
    }
  };

  WebVRCommon.prototype._clear = function () {
    var gl = this.gl;
    var clearFlags = 0;

    if (this.clearDepth) {
      clearFlags |= gl.DEPTH_BUFFER_BIT;
    }

    if (this.clearColor) {
      gl.clearColor(this.clearColor.r, this.clearColor.g, this.clearColor.b, this.clearColor.a);
      clearFlags |= gl.COLOR_BUFFER_BIT;
    }

    if (clearFlags) {
      gl.clear(clearFlags);
    }
  };

  WebVRCommon.prototype._onAnimationFrame = function (timestamp) {
    this._preUpdate(timestamp);
    this._update(timestamp);
    this._render(timestamp);
  }

  WebVRCommon.prototype.addHTMLMessage = function (msgText) {
      if (this.messageElement) {
        var message = document.createElement("div");
        message.innerHTML = msgText;
        this.messageElement.appendChild(message);
      }
  };

  exports.WebVRCommon = WebVRCommon;
})(window);