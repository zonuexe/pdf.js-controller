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
function domMap<T extends Record<string, string>>(parentNode: ParentNode, mapping: T): { [K in keyof T]: Element | null } {
    var mappingKeys = Object.keys(mapping) as Array<keyof T>;
    return mappingKeys.reduce(function (object: { [K in keyof T]: Element | null }, key: keyof T) {
        var selector = mapping[key];
        object[key] = parentNode.querySelector(selector) as Element | null;
        return object;
    }, {} as { [K in keyof T]: Element | null });
}
export = domMap;
