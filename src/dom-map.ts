/**
 * Created by azu on 2014/09/27.
 * LICENSE : MIT
 */

type SelectorMap = Record<string, string>;

type DomMapResult<Selectors extends SelectorMap> = {
    [K in keyof Selectors]: Element | null;
};

const domMap = <Selectors extends SelectorMap, Result extends DomMapResult<Selectors> = DomMapResult<Selectors>>(parentNode: ParentNode, mapping: Selectors): Result => {
    const resolvedEntries = (Object.entries(mapping) as Array<[keyof Selectors, Selectors[keyof Selectors]]>).map(
        ([key, selector]) => [key, parentNode.querySelector(selector)] as const
    );
    return Object.fromEntries(resolvedEntries) as Result;
};

export default domMap;
