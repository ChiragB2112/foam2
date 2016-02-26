/**
  This plugin is for JSDocs, to allow FOAM models to be documented.

  Document objects with a 'documentation' property, or put a JSDoc comment
  before their declaration as normal.

  ** Exception: **
  For properties or methods declared with object syntax, put the comment
  inside the object (or use a documentation property):
  {
    /** Comment goes here! * /
    name: 'thing'
  }

  For any other thing:

  {
    name: 'thing2',
    documentation: "Docs inside thing2"
  }

  or

  /** Comment before * /
  foam.CLASS({
    name: 'myClass',
    documentation: "or docs inside",
  })

  or

  methods: [
    /** Comment before * /
    function aMethod() {},
    function bMethod() {
      /** doc as first comment in function * /
      func contents...
    }
  ]


*/

var fs = require('fs');
require("../js/core/load.js");

var getNodePropertyNamed = function getNodePropertyNamed(node, propName) {
  if ( node.properties ) {
    for (var i = 0; i < node.properties.length; ++i) {
      var p = node.properties[i];
      if ( p.key && p.key.name == propName ) {
        return ( p.value && p.value.value ) || '';
      }
    }
  }
  return '';
}
var getNodeNamed = function getNodeNamed(node, propName) {
  if ( node.properties ) {
    for (var i = 0; i < node.properties.length; ++i) {
      var p = node.properties[i];
      if ( p.key && p.key.name == propName ) {
        return p.value;
      }
    }
  }
  return '';
}


var getLeadingComment = function getLeadingComment(node) {
  // climb up the tree and look for a docs comment
  if (node.leadingComments) return node.leadingComments[0].raw;
  if (node.parent) {
    if (node.parent.leadingComments) return node.parent.leadingComments[0].raw;
    if (node.parent.callee) {
      if (node.parent.callee.leadingComments) return node.parent.callee.leadingComments[0].raw;
      if (node.parent.callee.parent) {
        if (node.parent.callee.parent.leadingComments) return node.parent.callee.parent.leadingComments[0].raw;
      }
    }
  }
  return '';
}

var getFuncBodyComment = function getFuncBodyComment(node, filename) {
  // try to pull a comment from the function body
  var src = getSourceString(filename, node.range[0], node.range[1]);
  var matches = src.match(/function[^]*?\([^]*?\)[^]*?\{[^]*?(\/\*\*[^]*?\*\/)/);
  if (matches && matches[1]) {
    return matches[1];
  } else {
    // fallback: there might be a parsed comment left behind if the first statement
    // of the function is on the JSDocs 'good' list
    if (  node.body &&
          node.body.body &&
          node.body.body[0] &&
          node.body.body[0].leadingComments ) {
      return node.body.body[0].leadingComments[0].raw;
    }
    return '';
  }
}

var getComment = function getComment(node, filename) {
  // try for FOAM documentation property/in-function comment block
  // Object expression with documentation property
  var docProp = getNodePropertyNamed(node, 'documentation');
  if ( docProp ) {
    return "/** "+docProp+ " */";
  }
  // function with potential block comment inside
  else if ( node.type === 'FunctionExpression' ) {
    var comment = getFuncBodyComment(node, filename);
    if ( comment ) return comment;
  }

  // fall back on standard JSDoc leading comment blocks
  return getLeadingComment(node);

}

var getCLASSName = function getCLASSName(node) {
  var pkg = getNodePropertyNamed(node, 'package').replace(/\./g, '/');
  return ( pkg ? pkg + '.' : 'foam/core.' ) + getNodePropertyNamed(node, 'name');
}
var getCLASSExtends = function getCLASSExtends(node) {
  var ext = getNodePropertyNamed(node, 'extends');
  if (ext) {
    // replace package dots with module slashes
    ext = ext.replace(/\./g, '/');
    var i = ext.lastIndexOf('/');
    if ( i > 0 ) {
      ext = ext.substring(0,i) + "." + ext.substring(i+1);
    } else {
      ext = "foam/core."+ext;
    }
  }
  return ext;
}

var insertIntoComment = function insertIntoComment(comment, tag) {
  var idx = comment.lastIndexOf('*/');
  return comment.slice(0, idx) + " "+tag+" " + comment.slice(idx);
}

var replaceCommentArg = function replaceCommentArg(comment, name, type, docs) {
  // if the @arg is defined in the comment, add the type, otherwise insert
  // the @arg directive. Documentation (if any) from the argument declaration
  // is only used if the @arg is not specified in the original comment.
  var found = false;
  var ret = comment.replace(
    new RegExp('(@param|@arg)\\s*({.*?})?\\s*'+name+'\\s', 'gm'),
    function(match, p1, p2) {
      found = true;
      if ( p2 ) return match; // a type was specified, abort
      return p1 + " {" + type + "} " + name + " ";
    }
  );

  if ( found ) return ret;
  return insertIntoComment(comment, "\n@arg {"+type+"} "+name+" "+docs);
}


var files = {};
var getSourceString = function getSourceString(filename, start, end) {
  // Load the given file and find the original unparsed source
  var file;
  if ( ! files[filename] ) {
    files[filename] = fs.readFileSync(filename, 'utf8');
  }
  file = files[filename];

  return file.substring(start, end);
}

var processArgs = function processArgs(e, node) {
   // extract arg types using FOAM
  var src = getSourceString(e.filename, node.range[0], node.range[1]);
  try {
    var args = foam.types.getFunctionArgs(src);
    for (var i = 0; i < args.length; ++i) {
      var arg = args[i];
      if ( arg.typeName ) {
        e.comment = replaceCommentArg(e.comment, arg.name, arg.typeName, arg.documentation);
      }
    }
  } catch(err) {
    console.log("Args not processed for ", err);
  }
}



var i = 0;
exports.astNodeVisitor = {
  visitNode: function(node, e, parser, currentSourceName) {
    // NOTE: JSDocs strips comments it thinks are not useful. We get around this
    //       by loading the actual source file and pulling strings from it when
    //       necessary.

    // TODO: generalize for listeners and other things.

    // CLASS or LIB
    if (node.type === 'ObjectExpression' &&
      node.parent && node.parent.type === 'CallExpression' &&
      node.parent.callee && node.parent.callee.property &&
      ( node.parent.callee.property.name == 'CLASS' || node.parent.callee.property.name == 'LIB' )
    ) {
      var className = getNodePropertyNamed(node, "name");
      var classPackage = getNodePropertyNamed(node, "package").replace(/\./g, '/') || 'foam/core';
      var classExt = getCLASSExtends(node);
      e.id = 'astnode'+Date.now();
      e.comment = insertIntoComment(
        getComment(node, currentSourceName),
        "\n@class " +
        ( ( classExt ) ? "\n@extends module:"+classExt : "") +
        ( classPackage ? "\n@memberof! module:"+classPackage : "" )
      );
      e.lineno = node.parent.loc.start.line;
      e.filename = currentSourceName;
      e.astnode = node;
      e.code = {
          name: className,
          type: "class",
          node: node
      };
      e.event = "symbolFound";
      e.finishers = [parser.addDocletRef];
      console.log("********",e.comment, className, classPackage);

    } // function in an array (methods, todo: listeners, etc)
    else if (node.type === 'FunctionExpression' &&
      node.parent.type === 'ArrayExpression' &&
      node.parent.parent.type === 'Property' &&
      node.parent.parent.key.name === 'methods'
    ) {
      var parentClass = getCLASSName(node.parent.parent.parent);
      e.id = 'astnode'+Date.now();
      e.comment = insertIntoComment(
        getComment(node, currentSourceName),
        "\n@method \n@memberof! module:"+parentClass + ".prototype"
      );
      e.lineno = node.parent.loc.start.line;
      e.filename = currentSourceName;
      e.astnode = node;
      e.code = {
          name: (node.id && node.id.name || 'NameError'),
          type: "function",
          node: node
      };
      e.event = "symbolFound";
      e.finishers = [parser.addDocletRef];

      processArgs(e, node);

    } // objects in an array (properties, methods, todo: others)
    else if (node.type === 'ObjectExpression' &&
      node.parent.type === 'ArrayExpression' &&
      node.parent.parent.type === 'Property' &&
      ( node.parent.parent.key.name === 'properties' ||
        node.parent.parent.key.name === 'methods' )
    ) {
      var parentClass = getCLASSName(node.parent.parent.parent);
      e.id = 'astnode'+Date.now();
      e.comment = insertIntoComment(
        getComment(node.properties[0], currentSourceName) || getComment(node, currentSourceName),
        (( node.parent.parent.key.name === 'methods' ) ? "\n@method " : "") +
          "\n@memberof! module:"+parentClass + ".prototype"
      );
      e.lineno = node.parent.loc.start.line;
      e.filename = currentSourceName;
      e.astnode = node;
      e.code = {
          name: getNodePropertyNamed(node,'name'),
          type: "property",
          node: node
      };
      e.event = "symbolFound";
      e.finishers = [parser.addDocletRef];

      if (node.parent.parent.key.name === 'methods')
        processArgs(e, getNodeNamed(node, 'code'));
    }
  }
};
