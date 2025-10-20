/**
 * Created by azu on 2014/09/27.
 * LICENSE : MIT
 */

type SelectorMap = Record<string, string>;

type DomMapResult<Selectors extends SelectorMap> = {
    [K in keyof Selectors]: Element | null;
};

const domMap = <Selectors extends SelectorMap, Result extends DomMapResult<Selectors> = DomMapResult<Selectors>>(parentNode: ParentNode, mapping: Selectors): Result => {
    const mappingKeys = Object.keys(mapping) as Array<keyof Selectors>;
    return mappingKeys.reduce<Result>((accumulator, key) => {
        const selector = mapping[key];
        accumulator[key] = parentNode.querySelector(selector) as Result[typeof key];
        return accumulator;
    }, {} as Result);
};

export default domMap;
