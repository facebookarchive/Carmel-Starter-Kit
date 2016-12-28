// Copyright 2016-present, Oculus VR, LLC.
// All rights reserved.
//
// This source code is licensed under the license found in the
// LICENSE-examples file in the root directory of this source tree.
(function (exports) {
  // Pano renders a panorama.
  //
  // webVRCommon - an instance of WebVRCommon, used for rendering
  // config - an object describing the configuration of the Pano
  //   opacity: <number> The amount of tranparency 0 - tranparent, 1 - opaque.
  //   src: <array> An array of strings describing the source images.
  //                The length of the array determines the input format.
  //                1: single equirect texture, mono vs. stereo is determined by config.stereoMode
  //                2: dual equirect textures, stereo mode.
  //                6: single cubemap textures, mono mode.
  //                12: dual cubemap textures, stereo mode.
  //   stereoMode: (optional)<string> disambiguates between mono and stereo modes when a single texture is used.
  //                                  can be Pano.MONO, Pano.STEREO_TOP_BOTTOM, or Pano.STEREO_LEFT_RIGHT
  //   geometrySrc: (optional)<string> path to the geometry json to loaded.  Defaults to ../assets/sphere.json
  //   generateMipmaps: (optional)<boolean> true if mipmaps should be generated. defaults false.
  var Pano = function (webVRCommon, config) {
    this.webVRCommon = webVRCommon;
    // reverse x/y because we're inside the sphere
    // scale the model because the IPD is baked into the texture
    var s = 5000;
    this.modelMat = new Float32Array([
      -s,  0, 0, 0,
       0, -s, 0, 0,
       0,  0, s, 0,
       0,  0, 0, 1,
    ]);
    this.texOffset = new Float32Array([0, 0]);
    this.texScale = new Float32Array([1, 1]);
    this.loaded = false;
    this.textureUnit = 0;
    this.opacity = config.opacity === undefined ? 1 : config.opacity;

    var src = this._decodeTextureType(config.src, config.stereoMode);
    this._loadProgram();
    this._loadGeometry(config.geometrySrc);
    this._loadTextures(src, config.generateMipmaps);
  };

  Pano.MONO = 1;
  Pano.STEREO_TEXTURES = 2;
  Pano.STEREO_TOP_BOTTOM = 3;
  Pano.STEREO_LEFT_RIGHT = 4;

  // Interpret the length of src into a stereoMode and texture target
  Pano.prototype._decodeTextureType = function (src, stereoMode) {
    if (!src) { throw new Error("config.src is required"); }
    if (!Array.isArray(src)) { src = [src]; }

    switch(src.length) {
      case 1:
        this.textureTarget = this.webVRCommon.gl.TEXTURE_2D;
        this.stereoMode = stereoMode || Pano.MONO;
        break;
      case 2:
        this.textureTarget = this.webVRCommon.gl.TEXTURE_2D;
        this.stereoMode = Pano.STEREO_TEXTURES;
        break;
      case 6:
        this.textureTarget = this.webVRCommon.gl.TEXTURE_CUBE_MAP;
        this.stereoMode = Pano.MONO;
        break;
      case 12:
        this.textureTarget = this.webVRCommon.gl.TEXTURE_CUBE_MAP;
        this.stereoMode = Pano.STEREO_TEXTURES;
        break;
      default:
        throw new Error("config.src must be 1, 2, 6, or 12 image paths");
    }

    return src;
  };

  // Load shaders for cubemap or equirect Pano.
  Pano.prototype._loadProgram = function () {
    var vs, fs;
    switch (this.textureTarget) {
      case this.webVRCommon.gl.TEXTURE_2D:
        vs =  "uniform mat4 projectionMat;\n" +
              "uniform mat4 viewMat;\n" +
              "uniform mat4 modelMat;\n" +
              "uniform vec2 texOffset;\n" +
              "uniform vec2 texScale;\n" +
              "attribute vec3 position;\n" +
              "attribute vec2 texCoord;\n" +
              "varying vec2 vTexCoord;\n" +
              "void main() {\n" +
              "  vTexCoord = texCoord * texScale + texOffset;\n" +
              "  gl_Position = projectionMat * viewMat * modelMat * vec4(position.xyz, 1.0);\n" +
              "}\n";
        fs =  "precision mediump float;\n" +
              "uniform sampler2D texture;\n" +
              "uniform float opacity;\n" +
              "varying vec2 vTexCoord;\n" +
              "void main() {\n" +
              "  vec4 texture = texture2D(texture, vTexCoord);\n" +
              "  gl_FragColor = vec4(texture.rgb, texture.a * opacity);\n" +
              "}\n";
        break;
      case this.webVRCommon.gl.TEXTURE_CUBE_MAP:
        vs =  "uniform mat4 projectionMat;\n" +
              "uniform mat4 viewMat;\n" +
              "uniform mat4 modelMat;\n" +
              "attribute vec3 position;\n" +
              "varying vec3 vTexCoord;\n" +
              "void main() {\n" +
              "  vTexCoord = normalize(position) * vec3(-1.0, -1.0, 1.0);\n" +
              "  gl_Position = projectionMat * viewMat * modelMat * vec4(position.xyz, 1.0);\n" +
              "}\n";
        fs =  "precision mediump float;\n" +
              "uniform samplerCube texture;\n" +
              "uniform float opacity;\n" +
              "varying vec3 vTexCoord;\n" +
              "void main() {\n" +
              "  vec4 texture = textureCube(texture, vTexCoord);\n" +
              "  gl_FragColor = vec4(texture.rgb, texture.a * opacity);\n" +
              "}\n";
        break;
      default:
        throw new Error("unknown texture target");
    }

    this.programInfo = this.webVRCommon.loadProgram(vs, fs);
  };

  Pano.prototype._loadGeometry = function (geometrySrc) {
    this.geometryInfo = this.webVRCommon.loadGeometry({ src: geometrySrc || "../assets/sphere.json" });
  };

  // Load textures all at once.
  // TODO: incrementally load textures to recude large frame hitches
  Pano.prototype._loadTextures = function (src, mips) {
    switch(src.length) {
      case 1:
      case 2:
        this.leftTextureInfo = this.webVRCommon.loadTexture2D({
          generateMipmaps: mips || false,
          src: src[0],
        });
        if (src.length === 2) {
          this.rightTextureInfo = this.webVRCommon.loadTexture2D({
            generateMipmaps: mips || false,
            src: src[1],
          });
        } else {
          this.rightTextureInfo = this.leftTextureInfo;
        }
        break;
      case 6:
      case 12:
        this.leftTextureInfo = this.webVRCommon.loadTextureCube({
          generateMipmaps: mips || false,
          pos_x: src[0],
          neg_x: src[1],
          pos_y: src[2],
          neg_y: src[3],
          pos_z: src[4],
          neg_z: src[5],
        });
        if (src.length === 12) {
          this.rightTextureInfo = this.webVRCommon.loadTextureCube({
            generateMipmaps: mips || false,
            pos_x: src[6],
            neg_x: src[7],
            pos_y: src[8],
            neg_y: src[9],
            pos_z: src[10],
            neg_z: src[11],
          });
        } else {
          this.rightTextureInfo = this.leftTextureInfo;
        }
        break;
    };
  };

  // The pano is loaded if the geomatry and textures are loaded.
  Pano.prototype.isLoaded = function () {
    return this.geometryInfo.loaded && this.leftTextureInfo.loaded && this.rightTextureInfo.loaded;
  };

  // The binoculur effect is baked into the texture while in stereo mode, so we need to adjust for which eye is rendered.
  Pano.prototype.render = function (context) {
    if (!this.isLoaded()) return;
    this.textureInfo = (context.eye !== "right") ? this.leftTextureInfo : this.rightTextureInfo;
    var webVRCommon = this.webVRCommon;
    var gl = webVRCommon.gl;
    // don't need to read/write depth because we're filling the screen.
    gl.depthMask(false);
    gl.disable(gl.DEPTH_TEST);

    // Only blend if we need to.
    if (this.opacity < 1) {
      gl.enable(gl.BLEND);
      gl.blendEquation( gl.FUNC_ADD );
      gl.blendFunc( gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA );
    }

    // Some uniforms are common between both shaders
    webVRCommon.useGeometry(this.geometryInfo.geometry, this.programInfo);
    webVRCommon.useTexture(this.textureInfo, this.textureUnit);
    var uniforms = {
      texture: this.textureUnit,
      projectionMat: context.projectionMat,
      viewMat: context.viewMat,
      modelMat: this.modelMat,
      opacity: this.opacity
    };

    // If using equirect we have additional uniforms for selecting the left/right eye
    if (this.textureTarget === webVRCommon.gl.TEXTURE_2D) {
      switch (this.stereoMode) {
        case Pano.MONO:
        case Pano.STEREO_TEXTURES:
          this.texOffset[0] = 0;
          this.texOffset[1] = 0;
          this.texScale[0] = 1;
          this.texScale[1] = 1;
          break;
        case Pano.STEREO_TOP_BOTTOM:
          this.texOffset[0] = 0;
          this.texOffset[1] = (context.eye !== "left") ? 0 : 0.5;
          this.texScale[0] = 1;
          this.texScale[1] = 0.5;
          break;
        case Pano.STEREO_LEFT_RIGHT:
          this.texOffset[0] = (context.eye !== "left") ? 0 : 0.5;
          this.texOffset[1] = 0;
          this.texScale[0] = 0.5;
          this.texScale[1] = 1;
          break;
      }
      uniforms.texOffset = this.texOffset;
      uniforms.texScale = this.texScale;
    }
    webVRCommon.setUniforms(this.programInfo, uniforms);
    webVRCommon.drawGeometry(this.geometryInfo.geometry);

    // restore depth testing
    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
  };

  exports.Pano = Pano;
})(window);