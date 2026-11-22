import { buildRegressionTests } from '../src/components/AutomatedTestPanel';

const tests = buildRegressionTests();
const t33 = tests.find(t => t.id === 't-33');

if (t33) {
    console.log("Test t-33 Status:", t33.status);
    console.log("Assertion:", t33.assertion);
} else {
    console.log("Test t-33 not found");
}
