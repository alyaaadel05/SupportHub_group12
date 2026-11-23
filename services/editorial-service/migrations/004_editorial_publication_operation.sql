BEGIN;

ALTER TABLE editorial_workflow_operations
  DROP CONSTRAINT IF EXISTS editorial_workflow_operations_operation_type_check;

ALTER TABLE editorial_workflow_operations
  ADD CONSTRAINT editorial_workflow_operations_operation_type_check
  CHECK (operation_type IN ('submit', 'decide', 'publish'));

ALTER TABLE editorial_workflow_operations
  DROP CONSTRAINT IF EXISTS editorial_workflow_operation_shape_check;

ALTER TABLE editorial_workflow_operations
  ADD CONSTRAINT editorial_workflow_operation_shape_check
  CHECK (
    (
      operation_type = 'submit'
      AND from_status = 'draft'
      AND to_status = 'in_review'
      AND decision IS NULL
    )
    OR
    (
      operation_type = 'decide'
      AND from_status = 'in_review'
      AND decision IS NOT NULL
      AND (
        (decision = 'approved' AND to_status = 'approved')
        OR
        (decision = 'rejected' AND to_status = 'draft')
      )
    )
    OR
    (
      operation_type = 'publish'
      AND from_status = 'approved'
      AND to_status = 'published'
      AND decision IS NULL
    )
  );

COMMIT;
