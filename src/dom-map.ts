/**
 * Created by azu on 2014/09/27.
 * LICENSE : MIT
 */
"use strict";
/**
 *
 * @param {Node} parentNode
 * @param {object} mapping
 * @returns {Object.<string,Node>}
 */
function domMap(parentNode: ParentNode, mapping: Record<string, string>): Record<string, Element | null> {
    var mappingKeys = Object.keys(mapping);
    return mappingKeys.reduce(function (object: Record<string, Element | null>, key: string) {
        var selector = mapping[key];
        object[key] = parentNode.querySelector(selector);
        return object;
    }, {} as Record<string, Element | null>);
}
export = domMap;
