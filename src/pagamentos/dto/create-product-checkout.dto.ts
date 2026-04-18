import { IsNotEmpty, IsString, Length } from 'class-validator';

export class CreateProductCheckoutDto {
  @IsString()
  @IsNotEmpty()
  @Length(1, 100)
  produtoId!: string;
}
